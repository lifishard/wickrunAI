import React from 'react';
import { useT } from '../lib/i18n';
import type { MessageAnnotation } from '../types';

function Note({ note, onSave, onDelete }: { note: MessageAnnotation; onSave(n: MessageAnnotation): Promise<void>; onDelete(id: string): Promise<void> }) {
  const t = useT();
  const [editing, setEditing] = React.useState(false);
  const [text, setText] = React.useState(note.text);
  const [error, setError] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const action = async (fn: () => Promise<void>) => {
    setSaving(true); setError('');
    try { await fn(); setEditing(false); } catch (e) { setError(String(e)); } finally { setSaving(false); }
  };
  return <div className="message-note">
    <div className="message-note-head"><strong>{t('✎ 我的注释')}</strong>
      <button className="icon-btn" title={t('编辑注释')} aria-label={t('编辑注释')} disabled={saving} onClick={() => { setText(note.text); setEditing(true); }}>{t('编辑')}</button>
      <button className="icon-btn" title={t('删除注释')} aria-label={t('删除注释')} disabled={saving} onClick={() => void action(() => onDelete(note.id))}>{t('删除')}</button>
    </div>
    <blockquote>{note.quote.text}</blockquote>
    {editing ? <>
      <textarea aria-label={t('编辑注释')} rows={3} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="row"><button className="btn sm" disabled={saving} onClick={() => setEditing(false)}>{t('取消')}</button>
        <button className="btn sm primary" disabled={saving || !text.trim()} onClick={() => void action(() => onSave({ ...note, text: text.trim() }))}>{t('保存注释')}</button></div>
    </> : <div className="message-note-text">{note.text}</div>}
    {error ? <div role="alert" className="file-card-error">{error}</div> : null}
  </div>;
}
export default function MessageNotes(props: { notes?: MessageAnnotation[]; onSave: (n: MessageAnnotation) => Promise<void>; onDelete: (id: string) => Promise<void> }) {
  const t = useT();
  return props.notes?.length ? <div className="message-notes">{props.notes.map((n) => <Note key={n.id} note={n} onSave={props.onSave} onDelete={props.onDelete} />)}</div> : null;
}
