// Calcule le prochain numéro de version libre et l'écrit dans package.json
const { execSync } = require('child_process');
const fs = require('fs');

const tags = execSync('git tag')
  .toString()
  .split(/\r?\n/)
  .filter((x) => /^v\d+\.\d+\.\d+$/.test(x))
  .map((x) => x.slice(1).split('.').map(Number));

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
tags.push(pkg.version.split('.').map(Number));
tags.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
const last = tags[tags.length - 1];
const next = `${last[0]}.${last[1]}.${last[2] + 1}`;

pkg.version = next;
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
console.log(next);
