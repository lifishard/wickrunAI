import React from 'react';
import { Editor, Extension, markInputRule } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { isCompositionKey } from '../lib/composer-keyboard';

export interface MarkdownInputHandle { focus(): void; setSelectionRange(start: number, end: number): void }
interface Props {
  value: string; disabled?: boolean; placeholder: string;
  onChange: (markdown: string) => void; onCaret: (offset: number) => void;
  onKeyDown: (event: KeyboardEvent) => void; onPaste: (event: ClipboardEvent) => void;
}
// Markdown marks should also work next to Chinese characters without spaces.
const InlineRules=Extension.create({name:'composerInlineRules',addInputRules(){return [
  markInputRule({find:/(\*\*([^*\n]+)\*\*)$/,type:this.editor.schema.marks.bold}),
  markInputRule({find:/(~~([^~\n]+)~~)$/,type:this.editor.schema.marks.strike}),
];}});

/** A chat input with native editing history and IME handling; no editor toolbar. */
export default React.forwardRef<MarkdownInputHandle,Props>(function MarkdownInput(props,forwardedRef){
  const host=React.useRef<HTMLDivElement>(null),instance=React.useRef<Editor|null>(null);
  const current=React.useRef(props);current.current=props;
  const composing=React.useRef(false),lastEmitted=React.useRef(props.value);
  const prefix=(editor:Editor,pos:number)=>editor.markdown!.serialize(editor.state.doc.copy(editor.state.doc.content.cut(0,pos)).toJSON());
  React.useImperativeHandle(forwardedRef,()=>({
    focus(){instance.current?.commands.focus();},
    setSelectionRange(start,end){
      const editor=instance.current;if(!editor)return;
      // Used by slash completion only; document positions count rendered characters.
      const locate=(offset:number)=>{let best=1;editor.state.doc.descendants((node,pos)=>{if(node.isTextblock){const before=prefix(editor,pos);if(before.length<=offset)best=Math.min(pos+1+Math.max(0,offset-before.length-(pos?2:0)),pos+node.nodeSize-1);}});return best;};
      editor.commands.setTextSelection({from:locate(start),to:locate(end)});
    },
  }),[]);
  React.useLayoutEffect(()=>{
    if(!host.current)return;
    const editor=new Editor({element:host.current,extensions:[StarterKit.configure({underline:false,link:{openOnClick:false,autolink:false}}),InlineRules,Markdown.configure({markedOptions:{gfm:true,breaks:true}})],
      content:current.current.value,contentType:'markdown',editable:!current.current.disabled,injectCSS:false,
      editorProps:{attributes:{class:'composer-rich-input',role:'textbox','aria-label':'消息输入框','aria-multiline':'true','data-placeholder':current.current.placeholder},
        handleDOMEvents:{
          compositionstart(){composing.current=true;return false;},
          compositionend(){composing.current=false;return false;},
          blur(){composing.current=false;return false;},
          keydown(_view,event){if(isCompositionKey(event,composing.current))return true;current.current.onKeyDown(event);if(event.defaultPrevented)return true;if(event.key==='Enter'&&event.shiftKey&&!event.ctrlKey&&!event.metaKey){event.preventDefault();editor.commands.keyboardShortcut('Enter');return true;}return false;},
          paste(_view,event){current.current.onPaste(event);if(event.defaultPrevented)return true;
            if(event.clipboardData?.getData('text/html'))return false;
            const text=event.clipboardData?.getData('text/plain');
            if(text){event.preventDefault();editor.commands.insertContent(text,{contentType:'markdown'});return true;}return false;
          },
        },
      },
      onUpdate({editor}){const value=editor.getMarkdown();lastEmitted.current=value;current.current.onChange(value);current.current.onCaret(prefix(editor,editor.state.selection.from).length);},
      onSelectionUpdate({editor}){current.current.onCaret(prefix(editor,editor.state.selection.from).length);},
    });
    instance.current=editor;
    return ()=>{instance.current=null;editor.destroy();};
  },[]);
  React.useLayoutEffect(()=>{const editor=instance.current;if(!editor)return;
    if(props.value!==lastEmitted.current){editor.commands.setContent(props.value,{contentType:'markdown',emitUpdate:false});lastEmitted.current=props.value;}
    editor.setEditable(!props.disabled,false);
    editor.view.dom.setAttribute('data-placeholder',props.placeholder);
    editor.view.dom.setAttribute('aria-disabled',String(!!props.disabled));
  },[props.value,props.disabled,props.placeholder]);
  return <div className="composer-rich-host" ref={host} />;
});
