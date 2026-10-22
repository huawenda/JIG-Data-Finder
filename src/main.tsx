import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { applyTheme, readCachedTheme } from './core/theme'

/*
 * 首帧上色, 早于 React 挂载。
 *
 * 真正的主题在 config.json 里, 但它要异步读盘。若等读完再上色, 深色用户
 * 每次启动都会先看到一帧白底界面再闪成深色。这里先用 localStorage 里
 * 上次的选择把底色定住, App 内拿到配置后再以配置为准校正。
 */
applyTheme(readCachedTheme() ?? 'light')

const root = document.getElementById('root')
if (!root) throw new Error('#root not found')

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)