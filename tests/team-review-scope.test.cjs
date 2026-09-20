const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {verifyTeamReview}=require('./load-ts.cjs').loader()(path.resolve(__dirname,'../src/lib/team-contract.ts'));

function check(readPath,root,artifactPath='result.json'){
 const attempt={inputArtifacts:[{id:'v2',files:[{path:artifactPath,afterHash:'current'}]}],steps:[{id:'read',callId:'call',name:'read_file',status:'ok',args:{path:readPath}}]};
 return verifyTeamReview(JSON.stringify({verdict:'pass',evidence:['call'],changes:'Read the current artifact.',artifactIds:['v2']}),attempt,[root]);
}

test('review evidence must read the complete path in the receiver workspace',()=>{
 assert.equal(check('C:/review/result.json','C:/review').verdict,'pass');
 assert.equal(check('C:\\REVIEW\\result.json','c:/review/').verdict,'pass');
 assert.equal(check('/review/nested/../result.json','/review').verdict,'pass');
 assert.throws(()=>check('C:/review/reference/result.json','C:/review'),/全部改动文件/);
 assert.throws(()=>check('C:/other/result.json','C:/review'),/全部改动文件/);
 assert.throws(()=>check('C:/review/../other/result.json','C:/review'),/全部改动文件/);
 assert.throws(()=>check('/review/Result.json','/review'),/全部改动文件/);
 assert.throws(()=>check('result.json','not-an-absolute-root'),/全部改动文件/);
});

test('nested and UNC artifact paths retain their full identity',()=>{
 assert.equal(check('\\\\server\\share\\review\\sub\\result.json','//server/share/review','sub/result.json').verdict,'pass');
 assert.throws(()=>check('//server/other/review/sub/result.json','//server/share/review','sub/result.json'),/全部改动文件/);
 assert.throws(()=>check('/review/result.json','/review','sub/result.json'),/全部改动文件/);
});

test('read evidence without a versioned artifact cannot declare file review passed',()=>{
 const attempt={steps:[{id:'read',name:'read_file',status:'ok',args:{path:'/review/result.json'}}]};
 const verdict={verdict:'pass',evidence:['read'],changes:'No artifact was handed off.',artifactIds:[]};
 assert.throws(()=>verifyTeamReview(JSON.stringify(verdict),attempt,['/review']),/没有可核验的产物版本/);
 assert.equal(verifyTeamReview(JSON.stringify({...verdict,verdict:'unverifiable'}),attempt,['/review']).verdict,'unverifiable');
});
