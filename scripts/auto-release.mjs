import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
const version=JSON.parse(fs.readFileSync('package.json','utf8')).version;
if(!/^\d+\.\d+\.\d+$/.test(version))throw Error('Automatic releases require a stable version.');
if(process.env.GITHUB_REF!=='refs/heads/main'||!process.env.GITHUB_REPOSITORY||!/^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA||''))throw Error('Automatic release requires a checked main commit.');
const git=args=>execFileSync('git',args,{encoding:'utf8'}).trim();
const tags=git(['tag','--list','v*']).split('\n').filter(x=>/^v\d+\.\d+\.\d+$/.test(x));
const compare=(a,b)=>{const x=a.split('.').map(Number),y=b.split('.').map(Number);for(let i=0;i<3;i++)if(x[i]!==y[i])return x[i]-y[i];return 0;};
if(tags.some(t=>compare(t.slice(1),version)>=0)){console.log('No unpublished version increase; existing tags remain unchanged.');process.exit(0);}
const gh=args=>execFileSync('gh',args,{stdio:'inherit'});
const tag='v'+version;
gh(['api','--method','POST',`repos/${process.env.GITHUB_REPOSITORY}/git/refs`,'-f','ref=refs/tags/'+tag,'-f','sha='+process.env.GITHUB_SHA]);
// GITHUB_TOKEN-created tags do not emit another workflow push; dispatch explicitly.
gh(['workflow','run','release.yml','--ref',tag,'-f','dry_run=false']);
