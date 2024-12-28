// 检查content script是否已注入
async function isContentScriptInjected(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { action: 'ping' });
    return true;
  } catch (error) {
    return false;
  }
}

// 注入content script
async function injectContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js']
    });
    // 等待脚本加载
    return new Promise(resolve => setTimeout(resolve, 100));
  } catch (error) {
    console.error('注入content script失败:', error);
    throw error;
  }
}

// 处理点击事件
chrome.action.onClicked.addListener(async (tab) => {
  try {
    // 检查页面是否可访问
    if (!tab.url.startsWith('http')) {
      alert('此插件只能在网页上使用');
      return;
    }

    // 检查content script是否已注入
    const isInjected = await isContentScriptInjected(tab.id);
    if (!isInjected) {
      await injectContentScript(tab.id);
    }

    // 发送分析命令
    await chrome.tabs.sendMessage(tab.id, { action: 'analyze' });
  } catch (error) {
    console.error('操作失败:', error);
    // 如果是因为content script未加载导致的错误，尝试重新注入
    if (error.message.includes('Receiving end does not exist')) {
      try {
        await injectContentScript(tab.id);
        await chrome.tabs.sendMessage(tab.id, { action: 'analyze' });
      } catch (retryError) {
        console.error('重试失败:', retryError);
        alert('插件初始化失败，请刷新页面后重试');
      }
    } else {
      alert('分析失败，请刷新页面后重试');
    }
  }
});

chrome.runtime.onInstalled.addListener(() => {
  console.log('插件已安装');
}); 