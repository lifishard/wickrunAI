const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {normalizeImages}=require('../electron/client-images.cjs');
const {loader}=require('./load-ts.cjs');
const {clientContent}=loader()(path.join(__dirname,'../src/lib/client-content.ts'));
const png='data:image/png;base64,aGVsbG8=';

test('native transcript keeps image role and order without embedding bytes into prompt text',()=>{
  const original=[{role:'user',content:[{type:'text',text:'First image'},{type:'image_url',image_url:{url:png}}]},
    {role:'assistant',content:'Earlier answer'},
    {role:'user',content:[{type:'text',text:'Compare with this'},{type:'image_url',image_url:{url:png}}]}];
  const before=JSON.stringify(original),result=clientContent(original);
  assert.deepEqual(result.images,[png,png]);assert.equal(JSON.stringify(original),before);
  assert.doesNotMatch(JSON.stringify(result.transcript),/base64/);
  assert.equal(result.transcript[0].role,'user');assert.match(result.transcript[0].content[1].text,/Image 1/);
  assert.match(result.transcript[2].content[1].text,/Image 2/);
});

test('inline images are validated without allowing host paths or URL fetches',()=>{
  assert.deepEqual(normalizeImages(),[]);
  assert.deepEqual(normalizeImages([png]),[{dataUrl:png,mimeType:'image/png',data:'aGVsbG8='}]);
  for(const images of [null,{},[null],['https://example.com/a.png'],['C:/private.png'],['data:text/html;base64,aGVsbG8='],['data:image/png;base64,'],['data:image/png;base64,===='],['data:image/png;base64,aG=sbG8='],Array(101).fill(png)])assert.throws(()=>normalizeImages(images));
  assert.throws(()=>normalizeImages(['data:image/png;base64,'+'a'.repeat(28*1024*1024)]),/20MB/);
});
