const test=require('node:test'),assert=require('node:assert/strict');
const c=require('./fixtures/team-strategy-case.cjs');
test('strategy pilot oracle rejects the superseded rule and changed source bytes',()=>{
 const good=JSON.stringify({included_ids:['r2','r3','r4'],total_cents:1250});
 assert.equal(c.validate(good,c.input).passed,true);
 assert.deepEqual(c.validate('{',c.input).failures,['invalid_json']);
 assert.equal(c.validate(JSON.stringify({included_ids:['r1','r2','r3','r4'],total_cents:2750}),c.input).passed,false);
 assert.deepEqual(c.validate(good,c.input+'\n').failures,['input_modified']);
 assert.equal(c.validate('null',c.input).passed,false);
 assert.equal(c.validate(JSON.stringify({included_ids:['r2','r3','r4'],total_cents:1250,claimed_pass:true}),c.input).passed,false);
});
