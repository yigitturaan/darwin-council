import solc from 'solc';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

mkdirSync(resolve('backend/contracts/build'), { recursive: true });
for (const name of ['DarwinCommit','DarwinLineage']) {
  const file = `${name}.sol`;
  const source = readFileSync(resolve(`backend/contracts/${file}`), 'utf8');
  const input = { language: 'Solidity', sources: { [file]: { content: source } },
    settings: { optimizer: { enabled: true, runs: 200 }, outputSelection: { '*': { '*': ['abi','evm.bytecode.object'] } } } };
  const result = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (result.errors || []).filter((e) => e.severity === 'error');
  if (errors.length) throw new Error(errors.map((e) => e.formattedMessage).join('\n'));
  const artifact = result.contracts[file][name];
  writeFileSync(resolve(`backend/contracts/build/${name}.json`), JSON.stringify({ abi: artifact.abi,
    bytecode: `0x${artifact.evm.bytecode.object}` }, null, 2));
  console.log(`Compiled ${file}`);
}
