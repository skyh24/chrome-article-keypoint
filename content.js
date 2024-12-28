const DEEPSEEK_KEY = 'TODO';
const API_URL = 'https://api.deepseek.com/v1/chat/completions';
const DEBUG = false;
const ARTICLE_SELECTORS = [
  'article',
  '[role="article"]',
  '.article-content',
  '.post-content',
  '.entry-content',
  '.content-area',
  'main'
];
const HIGHLIGHT_COLORS = {
  key_sentence: '#fff566', // 关键句子用黄色
  key_term: '#b7eb8f'     // 关键词用绿色
};

function debug(...args) {
  if (DEBUG) {
    console.log('[Article Highlighter]', ...args);
  }
}

// 创建侧边栏
function createSidebar() {
  const sidebar = document.createElement('div');
  sidebar.id = 'article-summary-sidebar';
  document.body.appendChild(sidebar);
  return sidebar;
}

// 解析API响应
function parseAPIResponse(data) {
  try {
    console.log('开始解析API响应:', data);
    const content = data.choices[0].message.content;
    console.log('提取到的content:', content);
    
    let jsonData;
    try {
      const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/);
      if (jsonMatch) {
        jsonData = JSON.parse(jsonMatch[1]);
      } else {
        jsonData = JSON.parse(content);
      }
    } catch (e) {
      console.error('JSON解析失败，尝试清理内容后重新解析');
      const cleanContent = content
        .replace(/```json\n?/g, '')
        .replace(/\n?```/g, '')
        .trim();
      jsonData = JSON.parse(cleanContent);
    }
    
    console.log('解析后的JSON数据:', jsonData);
    
    if (!jsonData.sentences || !jsonData.terms) {
      throw new Error('数据格式不完整，需要包含sentences和terms字段');
    }
    
    const sentences = jsonData.sentences.map(item => {
      if (!item.text || !item.paragraph) {
        console.warn('句子数据格式不完整:', item);
        return null;
      }
      return {
        text: item.text.trim(),
        paragraph: parseInt(item.paragraph),
        type: 'key_sentence'
      };
    }).filter(item => item !== null);

    const terms = jsonData.terms.map(item => {
      if (!item.text || !item.paragraph) {
        console.warn('关键词数据格式不完整:', item);
        return null;
      }
      return {
        text: item.text.trim(),
        paragraph: parseInt(item.paragraph),
        type: 'key_term'
      };
    }).filter(item => item !== null);
    
    const results = [...sentences, ...terms];
    console.log('最终处理的结果:', results);
    
    if (results.length === 0) {
      throw new Error('没有找到有效的高亮内容');
    }
    return results;
  } catch (error) {
    console.error('解析API响应失败:', error);
    throw error;
  }
}

// 监听来自popup的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('收到消息:', request);
  if (request.action === 'ping') {
    sendResponse({status: 'ok'});
    return false;
  }
  if (request.action === 'analyze') {
    sendResponse({status: 'started'});
    analyzeArticle();
    return false;
  }
  return false;
});

// 获取文章正文和段落
function getArticleContent() {
  // 尝试找到文章容器
  let articleContainer = null;
  for (const selector of ARTICLE_SELECTORS) {
    articleContainer = document.querySelector(selector);
    if (articleContainer) break;
  }

  // 如果没找到容器，使用body作为后备
  if (!articleContainer) {
    articleContainer = document.body;
  }

  // 获取所有段落
  const paragraphs = Array.from(articleContainer.getElementsByTagName('p'))
    .filter(p => {
      const text = p.textContent.trim();
      // 过滤掉空段落和太短的段落
      return text.length > 20 && !p.querySelector('p');
    });

  // 构建段落映射
  const paragraphMap = new Map();
  paragraphs.forEach((p, index) => {
    paragraphMap.set(p, index + 1);
  });

  // 构建文章内容
  const articleContent = paragraphs.map((p, index) => ({
    text: p.textContent.trim(),
    paragraph: index + 1
  }));

  return { articleContent, paragraphMap, paragraphs };
}

// 查找段落和文本
function findParagraphAndText(text, paragraphNum, type) {
  const { paragraphs } = getArticleContent();
  let targetParagraph = null;

  // 先通过段落号查找
  if (paragraphNum && paragraphNum <= paragraphs.length) {
    targetParagraph = paragraphs[paragraphNum - 1];
  }

  // 如果没找到，在所有段落中查找文本
  if (!targetParagraph) {
    targetParagraph = paragraphs.find(p => p.textContent.includes(text));
  }

  if (targetParagraph) {
    // 获取段落的所有文本节点
    const textNodes = [];
    const walker = document.createTreeWalker(
      targetParagraph,
      NodeFilter.SHOW_TEXT,
      null,
      false
    );

    let node;
    while (node = walker.nextNode()) {
      textNodes.push(node);
    }

    // 在所有文本节点中查找匹配
    for (let node of textNodes) {
      const nodeText = node.textContent;
      const index = nodeText.indexOf(text);
      if (index !== -1) {
        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + text.length);
        
        // 检查是否与现有高亮重叠
        const existingHighlights = targetParagraph.querySelectorAll('.highlight');
        let canHighlight = true;
        
        for (let highlight of existingHighlights) {
          const highlightRange = document.createRange();
          highlightRange.selectNode(highlight);
          if (range.compareBoundaryPoints(Range.END_TO_START, highlightRange) < 0 &&
              range.compareBoundaryPoints(Range.START_TO_END, highlightRange) > 0) {
            canHighlight = false;
            break;
          }
        }

        if (canHighlight) {
          const wrapper = document.createElement('mark');
          wrapper.className = `highlight ${type}`;
          range.surroundContents(wrapper);
          return { element: wrapper, paragraph: targetParagraph };
        }
      }
    }
  }
  return null;
}

// 高亮文本并添加到侧边栏
function highlightAndSummarize(highlights) {
  const sidebar = createSidebar();
  
  highlights.forEach((item, index) => {
    // 高亮原文并获取段落
    const result = findParagraphAndText(item.text, item.paragraph, item.type);
    if (result) {
      result.element.dataset.highlightId = `highlight-${index}`;
      
      // 只为关键句子创建侧边栏摘要
      if (item.type === 'key_sentence') {
        // 在侧边栏添加摘要
        const summary = document.createElement('div');
        summary.className = 'summary-item';
        summary.dataset.highlightId = `highlight-${index}`;
        summary.dataset.type = item.type;
        summary.textContent = item.text;
        
        // 点击滚动到段落头
        summary.addEventListener('click', () => {
          result.paragraph.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
        
        sidebar.appendChild(summary);
      }
    }
  });
}

// 添加调试面板
function createDebugPanel() {
  if (!DEBUG) return;
  
  const panel = document.createElement('div');
  panel.style.cssText = `
    position: fixed;
    left: 20px;
    top: 20px;
    width: 300px;
    max-height: 400px;
    background: white;
    box-shadow: 0 2px 12px rgba(0,0,0,0.1);
    border-radius: 8px;
    padding: 16px;
    overflow-y: auto;
    z-index: 10001;
    font-family: monospace;
    font-size: 12px;
  `;
  panel.id = 'article-highlighter-debug';
  document.body.appendChild(panel);
  return panel;
}

// 更新调试信息
function updateDebugInfo(info) {
  if (!DEBUG) return;
  const panel = document.getElementById('article-highlighter-debug') || createDebugPanel();
  const entry = document.createElement('div');
  entry.style.marginBottom = '8px';
  entry.style.borderBottom = '1px solid #eee';
  entry.style.paddingBottom = '8px';
  entry.textContent = typeof info === 'string' ? info : JSON.stringify(info, null, 2);
  panel.appendChild(entry);
}

// 调用DeepSeek API分析文章
async function analyzeArticle() {
  debug('开始分析文章');
  const { articleContent, paragraphMap, paragraphs } = getArticleContent();
  const content = JSON.stringify(articleContent, null, 2);
  const num = Math.floor(content.length / 500);
  updateDebugInfo('段落数量: ' + paragraphs.length + ' 关键句数量: ' + num);
  
  try {
    debug('发送API请求...');
    updateDebugInfo('正在发送API请求...');
    
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DEEPSEEK_KEY}`
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [{
          role: "user",
          content: `分析以下文章内容，提取关键句子和关键词。

要求：
1. 关键句子(sentences)：
   - 找出大约${num}个分布均匀的关键句子
   - 每个句子应该完整但简短（不超过30个字）
   - 必须从给定段落中选择，不要改变原文
   - 可以从同一段落选择多个重要句子
   - 应该包含文章的核心观点、重要数据和关键结论
   - 一些参考词语: 注意，提醒，重要，第一，更加，前，最后，必须，显著，关键，核心，主要，特别，最佳，最优，突出，总之，总的来说，因此，所以，综上所述
   - 如果信息密度大可以根据参考词语适当增加关键句数量

2. 关键词(terms)：
   - 提取文章中的关键新名词、链接、日期、数字等
   - 每个关键词应该简短精确
   - 必须是原文中出现的内容
   - ��别关注：
     * 专有名词和新概念
     * 具体的数字和日期
     * 重要的链接和引用
     * 技术术语和专业词汇

请返回如下JSON格式：
{
  "sentences": [
    {"text": "关键句子1", "paragraph": 段落号},
    {"text": "关键句子2", "paragraph": 段落号}
  ],
  "terms": [
    {"text": "关键词1", "paragraph": 段落号},
    {"text": "关键词2", "paragraph": 段落号}
  ]
}

文章内容（JSON格式）：
${content}`
        }]
      })
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    debug('收到API响应');
    const data = await response.json();
    updateDebugInfo('API响应数据: ' + JSON.stringify(data, null, 2));
    
    const highlights = parseAPIResponse(data);
    debug('解析后的高亮内容:', highlights);
    
    // 安全地显示调试信息
    updateDebugInfo(
      '找到 ' + highlights.length + ' 个关键句\n' +
      '第一个关键句: ' + (highlights[0]?.text || '无') + '\n' +
      '示例段落号: ' + (highlights[0]?.paragraph || '无')
    );
    
    if (highlights && highlights.length > 0) {
      // 移除已存在的侧边栏和高亮
      const existingSidebar = document.getElementById('article-summary-sidebar');
      if (existingSidebar) {
        existingSidebar.remove();
      }
      document.querySelectorAll('.highlight').forEach(el => {
        const parent = el.parentNode;
        parent.replaceChild(document.createTextNode(el.textContent), el);
      });
      
      highlightAndSummarize(highlights);
    } else {
      throw new Error('没有找到需要高亮的内容');
    }
  } catch (error) {
    debug('分析文章失败:', error);
    updateDebugInfo('错误: ' + error.message);
    alert('分析文章失败: ' + error.message);
  }
} 