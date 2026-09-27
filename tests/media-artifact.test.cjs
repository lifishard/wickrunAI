const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),os=require('node:os');
const {loader}=require('./load-ts.cjs');
const file=p=>path.join(__dirname,'..',p);
const load=loader({jszip:{default:require('jszip')}});
const proposal=load(file('src/lib/artifact-proposal.ts'));
test('partial AI changes require exact unique anchors and preserve rejected text',()=>{
  const source='alpha beta gamma';const edits=proposal.parseArtifactProposal('{"edits":[{"before":"alpha","after":"A"},{"before":"gamma","after":"G"}]}',source);
  assert.equal(proposal.applyArtifactProposals(source,[edits[1]]),'alpha beta G');
  assert.throws(()=>proposal.parseArtifactProposal('{"edits":[{"before":"a","after":"x"}]}','a a'),/唯一/);
  assert.throws(()=>proposal.applyArtifactProposals('changed',[edits[0]]),/变化/);
  assert.throws(()=>proposal.parseArtifactProposal('{"edits":[{"before":"alpha","after":"A"},{"before":"pha","after":"p"}]}',source),/重叠/);
});
test('media wire payloads retain audio/video and never count base64 as text tokens',()=>{
  const {mediaParts,validateMediaRoute}=load(file('src/lib/media-input.ts'));
  const {estimateRequestTokens}=load(file('src/lib/limits.ts'));
  const attachments=[{kind:'audio',name:'a',dataUrl:'data:audio/wav;base64,YQ=='},{kind:'video',name:'v',dataUrl:'data:video/mp4;base64,Yg=='}];
  assert.deepEqual(JSON.parse(JSON.stringify(mediaParts(attachments))),[{type:'input_audio',input_audio:{data:'YQ==',format:'wav'}},{type:'video_url',video_url:{url:'data:video/mp4;base64,Yg=='}}]);
  const request=data=>({messages:[{role:'user',content:[{type:'input_audio',input_audio:{data,format:'wav'}}]}]});
  assert.equal(estimateRequestTokens(request('a')),estimateRequestTokens(request('a'.repeat(1e6))));
  const profile={id:'p',baseUrl:'https://api.invalid/v1'};
  assert.throws(()=>validateMediaRoute([{attachments}],profile,'m',{inputModalities:['text']}),/不支持/);
  assert.throws(()=>validateMediaRoute([{attachments}],profile,'m'),/尚未确认/);
  assert.doesNotThrow(()=>validateMediaRoute([{attachments}],profile,'m',{inputModalities:['text','audio','video']}));
});
test('bridge image extraction preserves association and keeps bytes outside task text',()=>{
  const {bridgeImages}=load(file('src/lib/bridge-images.ts'));
  const input=[{content:'read',attachments:[{kind:'image',name:'chart.png',dataUrl:'data:image/png;base64,xyz'}]}];
  const value=bridgeImages(input);assert.equal(value.images[0].name,'chart.png');assert.match(value.history[0].attachments[0].text,/image-1/);assert.equal(value.history[0].attachments[0].dataUrl,undefined);assert.equal(input[0].attachments[0].kind,'image');
});
test('DOCX editing preserves other ZIP parts and unaffected run formatting',async()=>{
  Object.assign(global,require('@xmldom/xmldom'));
  const JSZip=require('jszip'),zip=new JSZip();
  zip.file('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Hello </w:t></w:r><w:r><w:t>world</w:t></w:r></w:p><w:p><w:r><w:t>KEEP</w:t></w:r></w:p></w:body></w:document>');zip.file('word/media/image.png','unchanged');
  const {readOfficeDraft,patchOfficeDraft}=load(file('src/lib/office-edit.ts'));
  const draft=await readOfficeDraft(await zip.generateAsync({type:'uint8array'}),'docx');
  const result=await patchOfficeDraft(draft,{id:'0',before:'Hello world',after:'Hello friend'});const output=await JSZip.loadAsync(result);
  assert.equal((await readOfficeDraft(result,'docx')).paragraphs[0].text,'Hello friend');
  assert.equal(await output.file('word/media/image.png').async('string'),'unchanged');
  assert.match(await output.file('word/document.xml').async('string'),/<w:b\s*\/>/);
  assert.equal((await readOfficeDraft(result,'docx')).paragraphs[1].text,'KEEP');
});
test('spreadsheet edits keep formulas, styles and other sheets, rejecting formula targets',async()=>{
  Object.assign(global,require('@xmldom/xmldom'));
  const XLSX=require('xlsx'),book=XLSX.utils.book_new(),sheet=XLSX.utils.aoa_to_sheet([['cost',2],[null,4]]);sheet.B3={t:'n',f:'SUM(B1:B2)',v:6};sheet['!ref']='A1:B3';XLSX.utils.book_append_sheet(book,sheet,'Plan');XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['KEEP']]),'Other');
  const {readOfficeDraft,patchOfficeDraft}=load(file('src/lib/office-edit.ts'));const draft=await readOfficeDraft(XLSX.write(book,{type:'buffer',bookType:'xlsx'}),'xlsx');
  const changed=await patchOfficeDraft(draft,{id:'B1',sheet:draft.sheets[0].path,before:'2',after:'8'});const out=XLSX.read(changed,{type:'array'});
  assert.equal(out.Sheets.Plan.B1.v,8);assert.equal(out.Sheets.Plan.B3.f,'SUM(B1:B2)');assert.equal(out.Sheets.Other.A1.v,'KEEP');
  await assert.rejects(patchOfficeDraft(draft,{id:'B3',sheet:draft.sheets[0].path,before:'=SUM(B1:B2)',after:'x'}),/公式/);
});
test('binary document writes use conflict checks, restore exact bytes, and bound backups',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'wickrun-binary-test-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const p=path.join(root,'sample.pdf');fs.writeFileSync(p,'%PDF-1.4 original');const {createBinaryWorkspace}=require('../electron/artifact-binary.cjs'),api=createBinaryWorkspace(path.join(root,'history'));
  let snapshot=api.read(p);const original=snapshot.hash;
  snapshot=api.save({path:p,expectedHash:snapshot.hash,bytes:Buffer.from('%PDF-1.4 changed')});assert.throws(()=>api.save({path:p,expectedHash:original,bytes:Buffer.from('%PDF-1.4 wrong')}),/修改/);
  snapshot=api.restore({path:p,expectedHash:snapshot.hash,version:original});assert.equal(fs.readFileSync(p,'utf8'),'%PDF-1.4 original');
  for(let i=0;i<15;i++)snapshot=api.save({path:p,expectedHash:snapshot.hash,bytes:Buffer.from('%PDF-1.4 '+i)});
  assert.equal(snapshot.versions.length,9);const dir=path.join(root,'history',fs.readdirSync(path.join(root,'history'))[0]);assert.ok(fs.readdirSync(dir).filter(n=>n.endsWith('.bin')).length<=10);
});


test('context-budget image omission remains retrievable and does not break wire encoding',()=>{
  const {contextView}=load(file('src/lib/task-context.ts'));const {mediaParts}=load(file('src/lib/media-input.ts'));
  const original=[{id:'u',role:'user',content:'read images',createdAt:1,attachments:Array.from({length:4},(_,i)=>({kind:'image',name:String(i),dataUrl:'data:image/png;base64,YQ=='}))}];
  const view=contextView(original,[],4000,true);assert.ok(view[0].attachments.some(a=>a.contextOmitted));assert.equal(mediaParts(view[0].attachments).length,2);assert.ok(original[0].attachments.every(a=>a.dataUrl));
});
