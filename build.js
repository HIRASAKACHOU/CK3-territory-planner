// Optional developer step. End users can open the bundled HTML directly.
const fs = require('node:fs');
const path = require('node:path');
const read = name => fs.readFileSync(path.join(__dirname, name), 'utf8');
const html = read('index.html').replace(/<script src="(core|app)\.js"><\/script>/g,
  (_, name) => '<script>\n' + read(name + '.js') + '\n</script>');
fs.writeFileSync(path.join(__dirname, '省份领地规划器.html'), html);
console.log('Built standalone HTML');
