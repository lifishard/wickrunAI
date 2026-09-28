import { initializeAndroidAccount } from './lib/android-account';
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import './styles.css';
import './mobile.css';
import { installMobileViewport } from './lib/mobile-layout';
installMobileViewport();

const el = document.getElementById('root');
if (!el) throw new Error('找不到 #root 挂载点');

const renderApp=()=>createRoot(el).render(
  <React.StrictMode>
    {/* 兜底：任何地方渲染抛异常，至少把错误摆出来，而不是留一个点不动的死界面 */}
    <ErrorBoundary label="应用">
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);

void initializeAndroidAccount().then(renderApp).catch(()=>{
  el.textContent="无法读取此设备的账号存储。请关闭应用后重试；本机内容未被修改。";
});
