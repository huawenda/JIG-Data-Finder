"""
PySide2 最小桩件 (仅供 tools/ 下的基线脚本使用,不属于产品代码)

背景: 当前环境是 Python 3.12, PySide2 没有对应 wheel。但生成基线快照
只需要 worker.py / data_model.py 里的 pandas 业务逻辑, 不需要真实 Qt。

因此这里提供刚好够用的桩件, 让脚本能在 3.12 下复现旧版计算结果。
产品代码 (src/) 依然依赖真实的 PySide2, 未做任何改动。
"""


class _Signal:
    """可 connect / emit 的信号桩件"""

    def __init__(self, *args, **kwargs):
        self._slots = []

    def __get__(self, obj, objtype=None):
        if obj is None:
            return self
        return _BoundSignal(obj, self)

    def connect(self, slot):
        self._slots.append(slot)

    def disconnect(self, slot=None):
        if slot is None:
            self._slots.clear()
        elif slot in self._slots:
            self._slots.remove(slot)


class _BoundSignal:
    """绑定到实例后的信号, 转发到 class 级信号"""

    def __init__(self, obj, owner):
        self._obj = obj
        self._owner = owner

    def connect(self, slot):
        self._owner._slots.append(slot)

    def emit(self, *args):
        for slot in list(self._owner._slots):
            slot(*args)


def Signal(*args, **kwargs):
    return _Signal(*args, **kwargs)


def Slot(*args, **kwargs):
    def decorator(func):
        return func
    return decorator


class Qt:
    """枚举常量桩件, 只覆盖 data_model.py 用到的部分"""

    DisplayRole = 0
    TextAlignmentRole = 7
    ToolTipRole = 3
    FontRole = 6
    BackgroundRole = 8
    ForegroundRole = 9

    Horizontal = 1
    Vertical = 2

    class Orientation:
        Horizontal = 1
        Vertical = 2

    AlignCenter = 0x84

    class Checked:
        pass

    class Unchecked:
        pass


class QModelIndex:
    def __init__(self, row=-1, col=-1):
        self._row = row
        self._col = col

    def isValid(self):
        return self._row >= 0 and self._col >= 0

    def row(self):
        return self._row

    def column(self):
        return self._col


class QObject:
    def __init__(self, *args, **kwargs):
        pass


class QAbstractTableModel(QObject):
    dataChanged = Signal()

    def __init__(self, *args, **kwargs):
        super().__init__()
        self._rows = 0
        self._cols = 0

    def index(self, row, col, parent=None):
        return QModelIndex(row, col)


class QFont:
    def __init__(self, *args, **kwargs):
        self._bold = False

    def setBold(self, value):
        self._bold = value


class QColor:
    def __init__(self, *args, **kwargs):
        self._value = args[0] if args else None

    def name(self):
        return str(self._value)