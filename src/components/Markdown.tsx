import React from 'react';
import { useT } from '../lib/i18n';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/common';
import type { SourceRef } from '../types';
import { hasReadingSelection } from '../lib/reading-selection';
import { codeClipboardTexts } from '../lib/markdown-code';
import { writeCodeClipboard } from '../lib/code-clipboard';

/**
 * Markdown 渲染。
 * 流程固定为：插引用角标 → marked 转 HTML → DOMPurify 消毒 → 注入。
 * 模型的输出是不可信内容，任何时候都不要跳过消毒那一步。
 */

marked.setOptions({ gfm: true, breaks: true });

/**
 * 把正文里的 [1]、[2][3] 换成可点的角标。
 * 代码块里的方括号不能动 —— 按 ``` 切开，只处理偶数段（非代码段）。
 */
function injectCitations(md: string, sources: SourceRef[]): string {
  if (!sources.length) return md;
  const valid = new Set(sources.map((s) => s.n));

  return md
    .split(/(```[\s\S]*?```)/g)
    .map((seg, i) => {
      if (i % 2 === 1) return seg; // 代码块原样留着
      return seg.replace(/\[(\d{1,3})\]/g, (whole, num) => {
        const n = Number(num);
        if (!valid.has(n)) return whole; // 模型瞎编的编号，不给链接
        return `<sup class="cite" data-n="${n}">${n}</sup>`;
      });
    })
    .join('');
}

function render(md: string, sources: SourceRef[]): { html: string; codeCopies: string[] } {
  const codeTokens: { raw: string; text: string }[] = [];
  marked.walkTokens(marked.lexer(md), (token) => {
    if (token.type === 'code' && 'text' in token && typeof token.text === 'string') codeTokens.push({ raw: token.raw, text: token.text });
  });
  const codeCopies = codeClipboardTexts(md, codeTokens);
  const html = marked.parse(injectCitations(md, sources), { async: false }) as string;
  return { html: DOMPurify.sanitize(html, {
    ADD_ATTR: ['target', 'rel', 'data-n'],
    ADD_TAGS: ['sup'],
    FORBID_TAGS: ['style', 'form', 'input', 'button'],
    FORBID_ATTR: ['style', 'onerror', 'onload'],
  }), codeCopies };
}

const EMPTY_SOURCES: SourceRef[] = [];
export default function Markdown(props: {
  text: string;
  sources?: SourceRef[];
  onCiteClick?: (n: number) => void;
  copyText?: boolean;
}) {
  const t = useT();
  const ref = React.useRef<HTMLDivElement>(null);
  const sources = props.sources ?? EMPTY_SOURCES;
  const { html, codeCopies } = React.useMemo(() => render(props.text, sources), [props.text, sources]);
  const originalMarkup = React.useRef(new WeakMap<Node, string>());
  const appliedHtml = React.useRef<string | null>(null);
  const appliedText = React.useRef<string | null>(null);
  const [copied, setCopied] = React.useState<'idle' | 'ok' | 'error'>('idle');
  const resetCopy = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const syncContent = React.useCallback(() => {
    const root = ref.current;
    if (!root || (appliedHtml.current === html && appliedText.current === props.text) || hasReadingSelection(root)) return;

    // Preserve unchanged blocks (including code highlighting and copy buttons).
    // The template receives only the sanitized result from render().
    const template = document.createElement('template');
    template.innerHTML = html;
    const incoming = Array.from(template.content.childNodes);
    incoming.forEach((node, index) => {
      const markup = node.nodeType === Node.ELEMENT_NODE ? (node as Element).outerHTML : node.textContent ?? '';
      const existing = root.childNodes[index];
      if (existing && originalMarkup.current.get(existing) === markup) return;
      originalMarkup.current.set(node, markup);
      if (existing) root.replaceChild(node, existing);
      else root.appendChild(node);
    });
    while (root.childNodes.length > incoming.length) root.lastChild!.remove();
    appliedHtml.current = html;
    appliedText.current = props.text;

    root.querySelectorAll('pre code').forEach((block) => {
      const el = block as HTMLElement;
      if (el.dataset.highlighted === 'yes') return;
      try {
        hljs.highlightElement(el);
      } catch {
        /* 语言不认识就保持纯文本 */
      }
      el.dataset.highlighted = 'yes';
    });

    root.querySelectorAll('a[href]').forEach((a) => {
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noreferrer noopener');
    });

    root.querySelectorAll('pre').forEach((pre, index) => {
      let shell = pre.parentElement?.classList.contains('code-block') ? pre.parentElement : null;
      if (!shell) {
        shell = document.createElement('div');
        shell.className = 'code-block';
        const markup = originalMarkup.current.get(pre);
        if (markup) originalMarkup.current.set(shell, markup);
        pre.replaceWith(shell);
        shell.appendChild(pre);
      }
      let btn = shell.querySelector<HTMLButtonElement>('.copy-code');
      if (!btn) {
        btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'copy-code';
        btn.textContent = t('复制');
        shell.appendChild(btn);
      }
      btn.onclick = () => {
        const code = codeCopies[index] ?? pre.querySelector('code')?.textContent ?? '';
        void writeCodeClipboard(code).then(
          () => {
            btn.textContent = t('已复制');
            setTimeout(() => (btn.textContent = t('复制')), 1400);
          },
          () => {
            btn.textContent = t('复制失败');
            setTimeout(() => (btn.textContent = t('复制')), 1400);
          },
        );
      };
    });
  }, [html, codeCopies, props.text, t]);

  React.useLayoutEffect(syncContent, [syncContent]);
  React.useEffect(() => {
    // Resume the latest buffered render as soon as the user releases the selection.
    document.addEventListener('selectionchange', syncContent);
    return () => document.removeEventListener('selectionchange', syncContent);
  }, [syncContent]);

  // 角标点击：有外链就开浏览器，否则交给上层滚动到来源卡片
  React.useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.classList?.contains('cite')) return;
      const n = Number(t.dataset.n);
      const src = sources.find((s) => s.n === n);
      if (src?.url) {
        window.open(src.url, '_blank', 'noreferrer');
      } else {
        props.onCiteClick?.(n);
      }
    };
    root.addEventListener('click', onClick);
    return () => root.removeEventListener('click', onClick);
  }, [html, sources, props]);

  React.useEffect(() => () => { if (resetCopy.current) clearTimeout(resetCopy.current); }, []);
  const copyAll = () => {
    void navigator.clipboard.writeText(props.text).then(
      () => setCopied('ok'),
      () => setCopied('error'),
    ).finally(() => {
      if (resetCopy.current) clearTimeout(resetCopy.current);
      resetCopy.current = setTimeout(() => setCopied('idle'), 1400);
    });
  };
  return <div className={props.copyText ? 'md-copy-wrap' : undefined}>
    {props.copyText ? <button type="button" className="copy-text" onClick={copyAll}>{t(copied === 'ok' ? '已复制' : copied === 'error' ? '复制失败' : '复制')}</button> : null}
    <div className="md" ref={ref} />
  </div>;
}
