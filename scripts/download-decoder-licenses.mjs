import fs from 'node:fs/promises';
for(const [name,repository]of [['draco','google/draco'],['basis-universal','BinomialLLC/basis_universal']]){
 const response=await fetch(`https://api.github.com/repos/${repository}/contents/LICENSE`,{headers:{'User-Agent':'GameAssetWorkshop/0.1'},signal:AbortSignal.timeout(30000)});if(!response.ok)throw new Error(`${response.status}: ${name}`);const file=await response.json();if(!file.content)throw new Error('GitHub 未返回许可证正文');const directory=`resources/licenses/${name}`;await fs.mkdir(directory,{recursive:true});await fs.writeFile(`${directory}/LICENSE`,Buffer.from(file.content,'base64'));console.log(name,'license saved');
}
