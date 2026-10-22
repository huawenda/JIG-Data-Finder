/**
 * 例外对象面板
 *
 * 维护一张「这台具体治具做不到这个尺寸」的清单。
 *
 * ## 五列的职责
 *
 * 只有三列可编辑, 另外两列是派生出来的结果 —— 这个分工是面板的核心设计:
 *
 *   JIG ID    用户输入 (唯一必填的识别信息)
 *   型号      **派生**: 从当前源数据里查该编号, 不可编辑
 *   对应尺寸  **派生**: 用上面的型号查型号尺寸映射表, 不可编辑
 *   例外 P/N  用户选择 (固定两档: 6555 / 7783)
 *   例外类型  用户选择 (两项预设 + 自定义输入)
 *
 * 让型号和尺寸自动算, 是为了避免"人抄一遍"引入的错误: 这两列一旦和源数据
 * 或映射表对不上, 排查起来要跨三个地方对照。派生之后它们天然一致。
 *
 * ## 为什么录入不依赖源数据
 *
 * 例外清单是**持久化的设置**, 不是对某个文件的注解 —— 用户应该能在任何
 * 时候打开面板录入, 等下次加载数据时自然生效。
 *
 * 之前的实现里 P/N 下拉的选项来自"源数据里出现过的尺寸码", 没加载文件时
 * 下拉是空的, 校验随即报「例外 P/N 不能为空」, 保存按钮直接禁用。也就是说
 * 「必须先加载源数据」并不是某个开关, 而是这条选项依赖推导出来的副作用。
 * 现在 P/N 改成固定两档, 依赖消失, 录入自然自由。
 *
 * ## 例外 P/N 为什么是「档」而不是具体码
 *
 * 例外说的是「做不了 77/83 这一档玻璃」, 不是「做不了 7748 这个规格」。
 * 一档里会有 7748 / 7742 / 7727 / 8348 等多个码, 逐码录入既啰嗦又容易漏 ——
 * 漏一个就是一次误放行。所以选项固定成 6555 与 7783 两个族,
 * 判定时把源数据的 P/N 归一成族再比 (见 jigExceptions.ts 的 familyOf)。
 *
 * ## 型号列的三态
 *
 * 必须把"还没加载源文件"和"加载了但查不到这个编号"分开显示。混成一个
 * "不存在"的后果很具体: 用户打开面板时还没选文件, 满屏红字会让他以为
 * 名单里每一条都录错了。
 *
 *   pending  未加载源数据 -> 显示 —
 *   missing  已加载但查无此编号 -> 红字「不存在」
 *   mapped   查到 -> 显示型号
 *
 * 「不存在」只做提示, 不阻止保存 —— 源数据是按批次导出的, 一台治具今天
 * 不在表里不代表编号错了。是否真的错了, 由用户对着实物判断。
 *
 * ## 出厂预设与「恢复默认」
 *
 * 配置里默认就带着车间提供的 78 条 (见 jigExceptionPresets.ts), 所以全新
 * 安装或首次打开时面板不是空的。改乱了点「恢复默认」重置回这 78 条。
 *
 * 重置只改**面板内容**, 不写磁盘 —— 要落盘还得点「保存」, 因此误点仍有
 * 「取消」可退。这也是这里不弹二次确认的原因, 与型号尺寸面板保持一致。
 *
 * ## 与型号尺寸匹配面板的关系
 *
 * 两个面板改的是两份配置 (jigSizeMapping / jigExceptions), 保存时各自
 * 只 patch 自己的字段, 互不覆盖, 可以按任意顺序打开。这里只读映射表
 * 用来填「对应尺寸」列, 不写它。
 */

import { useEffect, useMemo, useState } from 'react'
import type { AppConfig } from '../core/config'
import {
  blankException,
  familyOf,
  JIG_ID_LENGTH,
  normalizeFamily,
  PRESET_TYPES,
  SIZE_FAMILIES,
  suggestType,
  validateJigExceptions,
} from '../core/jigExceptions'
import type { JigException } from '../core/jigExceptions'
import { createPresetExceptions } from '../core/jigExceptionPresets'
import type { Row } from '../core/table'

/** 源数据里的列名, 与 query.ts 的 applySizeMapping 保持一致 */
const COL_MODEL = 'Jig 对应型号'
const COL_JIG_ID = 'Jig ID'

/** 类型下拉里"自定义…"的哨兵值。不会与任何真实类型文字相等。 */
const CUSTOM_TYPE = '__custom__'

export interface JigExceptionDialogProps {
  config: AppConfig
  /** 当前已加载的源数据, 未加载时传空数组 */
  sourceRows: ReadonlyArray<Row>
  onSave: (list: JigException[]) => void
  onClose: () => void
}

/** 从 "252 252" 取首个型号, 与 query.ts 的 firstModel 同义 */
function firstWord(value: string): string {
  return value.trim().split(/\s+/)[0] ?? ''
}

export default function JigExceptionDialog({
  config,
  sourceRows,
  onSave,
  onClose,
}: JigExceptionDialogProps) {
  const [list, setList] = useState<JigException[]>(() =>
    config.jigExceptions.map((e) => ({ ...e })),
  )

  /**
   * 处于「自定义类型」输入态的行下标。
   *
   * 用行下标而不是记录 id 是因为记录本身没有稳定主键 (用户可以边输边改
   * JIG ID)。删除行时必须同步平移下标, 否则输入态会错到相邻行上。
   */
  const [customRows, setCustomRows] = useState<Set<number>>(() => {
    const s = new Set<number>()
    config.jigExceptions.forEach((e, i) => {
      const t = e.type.trim()
      if (t && !PRESET_TYPES.includes(t)) s.add(i)
    })
    return s
  })

  // ESC 关闭。对话框是模态的, 用户没法用鼠标点外面时至少还有键盘这条路。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const errors = useMemo(() => validateJigExceptions(list), [list])
  const errorCount = Object.keys(errors).length

  /** JIG ID -> 型号, 取自当前源数据。同编号重复出现时以首次为准。 */
  const modelByJigId = useMemo(() => {
    const map = new Map<string, string>()
    for (const r of sourceRows) {
      const id = (r[COL_JIG_ID] ?? '').trim()
      if (!id || map.has(id)) continue
      map.set(id, firstWord(r[COL_MODEL] ?? ''))
    }
    return map
  }, [sourceRows])

  const hasSource = sourceRows.length > 0

  const patch = (i: number, p: Partial<JigException>) =>
    setList((prev) => prev.map((row, idx) => (idx === i ? { ...row, ...p } : row)))

  const add = () => setList((prev) => [...prev, blankException()])

  /**
   * 恢复成出厂预设的 78 条。
   *
   * 与型号尺寸面板的「恢复默认」同一套行为: 直接重置, 不弹二次确认 ——
   * 两个面板的同类按钮必须先一致, 否则用户得猜哪个会问。
   *
   * 重置的是**面板内容**, 不是磁盘; 要落盘还得点「保存」, 所以误点以后
   * 仍有「取消」可退。这也是省略确认框的前提。
   *
   * customRows 必须一起清空: 那些下标指向的是旧列表的行, 新列表的同一
   * 位置是另一台治具, 留着会让某行莫名其妙变成可编辑的输入框。
   */
  const restore = () => {
    setList(createPresetExceptions())
    setCustomRows(new Set())
  }

  const remove = (i: number) => {
    setList((prev) => prev.filter((_, idx) => idx !== i))
    // 下标整体前移一位, 自定义输入态必须跟着移, 否则会错到相邻行
    setCustomRows((prev) => {
      const next = new Set<number>()
      prev.forEach((n) => {
        if (n < i) next.add(n)
        else if (n > i) next.add(n - 1)
      })
      return next
    })
  }

  /**
   * 选中尺寸族时顺手把类型填上。
   *
   * 只在类型为空时填 —— 用户自己写过的文案不能被覆盖。档与类型是一一对应的,
   * 78 条记录不该要人手动打 78 次「65例外」。
   */
  const pickFamily = (i: number, family: string) => {
    const current = list[i]
    patch(i, { pn: family, type: current.type.trim() ? current.type : suggestType(family) })
  }

  const revertToPreset = (i: number) => {
    setCustomRows((prev) => {
      const next = new Set(prev)
      next.delete(i)
      return next
    })
    patch(i, { type: '' })
  }

  /**
   * 保存前统一 trim, 并把 P/N 收敛成族标识。
   *
   * 存量配置里可能是完整 P/N 或 `7748` 这类具体码, 归一之后磁盘上只会有
   * `6555` / `7783` 两种写法。判定本来就按族比, 归一不影响结果, 只是让
   * 配置文件可读、也免去每次打开面板都要兼容三种形态。
   */
  const save = () => {
    onSave(
      list.map((e) => ({
        jigId: e.jigId.trim(),
        pn: normalizeFamily(e.pn),
        type: e.type.trim(),
      })),
    )
  }

  return (
    <div
      className="scrim"
      role="presentation"
      /*
       * 点遮罩空白处不关闭, 只有「取消」和 Esc 能关。
       * 这个面板最怕误触 —— 例外记录是一条条敲编号录进来的, 一次误点
       * 就会丢掉整屏未保存内容, 且没有撤销。三个面板统一这个规则。
       */
    >
      <div
        className="dialog dialog--xwide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="exc-title"
      >
        <div className="dialog__body">
          <h2 className="dialog__title" id="exc-title">
            例外对象
          </h2>

          <div className="exc">
            <div className="exc__head">
              <span className="exc__col" />
              <span className="exc__col">JIG ID</span>
              <span className="exc__col">型号</span>
              <span className="exc__col">对应尺寸</span>
              <span className="exc__col">例外 P/N</span>
              <span className="exc__col">例外类型</span>
              <span className="exc__col" />
            </div>

            <div className="exc__body">
              {list.length === 0 ? (
                <p className="exc__empty">还没有例外对象, 点下方「新增」开始添加。</p>
              ) : (
                list.map((e, i) => {
                  const model = modelByJigId.get(e.jigId.trim()) ?? ''
                  const state = !hasSource ? 'pending' : model ? 'mapped' : 'missing'
                  const size = model ? (config.jigSizeMapping[model] ?? '') : ''
                  // 存量记录可能是 7748 这类具体码, 显示时归到所在档
                  const family = familyOf(e.pn) ?? ''
                  const custom = customRows.has(i)

                  return (
                    <div className="exc__row" key={i}>
                      <span className="exc__idx">{i + 1}</span>

                      <input
                        className="exc__input"
                        value={e.jigId}
                        aria-label={`第 ${i + 1} 行 JIG ID`}
                        placeholder={`${JIG_ID_LENGTH} 位编号`}
                        aria-invalid={errors[i] ? 'true' : undefined}
                        data-invalid={errors[i] ? 'true' : undefined}
                        onChange={(ev) => patch(i, { jigId: ev.target.value })}
                      />

                      <span
                        className="exc__ro"
                        data-state={state === 'mapped' ? 'model' : state}
                        title={
                          state === 'pending'
                            ? '尚未加载源数据, 加载后自动匹配'
                            : state === 'missing'
                              ? `源数据里找不到编号 ${e.jigId.trim() || '(空)'}`
                              : `源数据型号: ${model}`
                        }
                      >
                        {/* 列头是「型号」, 所以这里只写「不存在」就够, 全称会撑破列宽 */}
                        {state === 'pending' ? '—' : state === 'missing' ? '不存在' : model}
                      </span>

                      <span className="exc__ro" title={size || '该型号未配置尺寸映射'}>
                        {size || (model ? '—' : '')}
                      </span>

                      <select
                        className="select exc__select"
                        value={family}
                        aria-label={`第 ${i + 1} 行例外 P/N`}
                        aria-invalid={errors[i] ? 'true' : undefined}
                        data-invalid={errors[i] ? 'true' : undefined}
                        onChange={(ev) => pickFamily(i, ev.target.value)}
                      >
                        {/* 占位项: 未选时显示「选择」, 但不出现在展开的候选项里 (disabled + hidden) */}
                        <option value="" disabled hidden>
                          选择
                        </option>
                        {SIZE_FAMILIES.map((f) => (
                          <option key={f} value={f}>
                            {f}
                          </option>
                        ))}
                      </select>

                      {custom ? (
                        <span className="exc__custom">
                          <input
                            className="exc__input"
                            value={e.type}
                            aria-label={`第 ${i + 1} 行例外类型(自定义)`}
                            placeholder="自定义类型"
                            onChange={(ev) => patch(i, { type: ev.target.value })}
                          />
                          <button
                            className="exc__revert"
                            type="button"
                            title="改回预设类型"
                            aria-label={`第 ${i + 1} 行改回预设类型`}
                            onClick={() => revertToPreset(i)}
                          >
                            ↩
                          </button>
                        </span>
                      ) : (
                        <select
                          className="select exc__select exc__select--type"
                          value={e.type}
                          aria-label={`第 ${i + 1} 行例外类型`}
                          onChange={(ev) => {
                            if (ev.target.value === CUSTOM_TYPE) {
                              setCustomRows((prev) => new Set(prev).add(i))
                              patch(i, { type: '' })
                              return
                            }
                            patch(i, { type: ev.target.value })
                          }}
                        >
                          {/* 同上: 占位项只用于未选时的显示, 不进候选项列表 */}
                          <option value="" disabled hidden>
                            选择类型
                          </option>
                          {PRESET_TYPES.map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                          <option value={CUSTOM_TYPE}>自定义…</option>
                        </select>
                      )}

                      <button
                        className="btn btn--danger btn--sm"
                        type="button"
                        aria-label={`删除第 ${i + 1} 行`}
                        onClick={() => remove(i)}
                      >
                        删除
                      </button>

                      {errors[i] && <span className="exc__err">{errors[i]}</span>}
                    </div>
                  )
                })
              )}
            </div>
          </div>

          {!hasSource && (
            <p className="exc__hint">
              当前未加载源数据 —— 型号与对应尺寸暂时无法显示, 但这不影响录入。
              可以先保存, 加载数据后会自动比对: 查得到的显示型号, 查不到的标「不存在」。
            </p>
          )}

          <div className="map__foot">
            <button className="btn" type="button" onClick={add}>
              新增
            </button>
            <button
              className="btn"
              type="button"
              title="把清单重置为出厂预设的 78 台治具 (未保存仍可取消)"
              onClick={restore}
            >
              恢复默认
            </button>
            <span className="map__spacer" />
            <span className="map__count" data-bad={errorCount > 0 ? 'true' : undefined}>
              {errorCount > 0 ? `${errorCount} 处有误` : `${list.length} 条例外`}
            </span>
          </div>

          {errorCount > 0 && (
            <p className="map__note">存在空值、长度不符或重复的编号, 修正后才能保存。</p>
          )}
        </div>

        <div className="dialog__foot">
          <button className="btn" type="button" onClick={onClose}>
            取消
          </button>
          <button className="btn btn--primary" type="button" disabled={errorCount > 0} onClick={save}>
            保存
          </button>
        </div>
      </div>
    </div>
  )
}
