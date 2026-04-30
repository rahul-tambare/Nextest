const fs = require('fs');
const path = require('path');

function traceEndpointFiles(repoPath, endpoint, method) {
  const templatePath = fs.existsSync(path.join(repoPath, 'template.yaml')) ? path.join(repoPath, 'template.yaml') : 
                       fs.existsSync(path.join(repoPath, 'template.yml')) ? path.join(repoPath, 'template.yml') : null;
  if (!templatePath) return null;

  const content = fs.readFileSync(templatePath, 'utf8');
  const lines = content.split('\n');
  
  let currentCodeUri = '';
  let currentHandler = '';
  let foundHandler = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    const codeUriMatch = line.match(/CodeUri:\s*['"]?([^'"\s]+)['"]?/);
    if (codeUriMatch) currentCodeUri = codeUriMatch[1];
    
    const handlerMatch = line.match(/Handler:\s*['"]?([^'"\s]+)['"]?/);
    if (handlerMatch) currentHandler = handlerMatch[1];

    const pathMatch = line.match(/Path:\s*['"]?([^'"\s]+)['"]?/);
    if (pathMatch) {
      let samPath = pathMatch[1];
      let samRegexStr = samPath.replace(/\{[^}]+\}/g, '[^/]+');
      let samRegex = new RegExp('^' + samRegexStr + '$');
      
      if (samRegex.test(endpoint) || endpoint === samPath) {
        for (let j = Math.max(0, i - 2); j < Math.min(i + 5, lines.length); j++) {
           const methodMatch = lines[j].match(/Method:\s*['"]?([^'"\s]+)['"]?/i);
           if (methodMatch && methodMatch[1].toLowerCase() === method.toLowerCase()) {
              foundHandler = { codeUri: currentCodeUri, handler: currentHandler };
              break;
           }
        }
      }
    }
  }
  
  if (!foundHandler) return null;

  let handlerFile = foundHandler.handler.split('.')[0]; 
  const filesToRead = new Set();
  const baseDir = path.join(repoPath, foundHandler.codeUri || '');
  
  const possibleFiles = [
    path.join(baseDir, handlerFile + '.js'),
    path.join(baseDir, handlerFile + '.ts'),
    path.join(repoPath, handlerFile + '.js'),
    path.join(repoPath, handlerFile + '.ts')
  ];
  
  let entryFile = null;
  for (const f of possibleFiles) {
    if (fs.existsSync(f)) {
      entryFile = f;
      break;
    }
  }
  
  if (!entryFile) return null;
  
  // Recursively find imports
  function traceImports(filePath, depth = 0) {
    if (depth > 3 || filesToRead.has(filePath) || !fs.existsSync(filePath)) return;
    filesToRead.add(filePath);
    
    const code = fs.readFileSync(filePath, 'utf8');
    const importRegex = /(?:require\(['"]([^'"]+)['"]\)|import\s+.*?\s+from\s+['"]([^'"]+)['"])/g;
    let match;
    while ((match = importRegex.exec(code)) !== null) {
      const importPath = match[1] || match[2];
      if (!importPath.startsWith('.')) continue; // ignore npm packages
      
      const dir = path.dirname(filePath);
      const resolvedBase = path.join(dir, importPath);
      
      const exts = ['.js', '.ts', '/index.js', '/index.ts', '.json'];
      for (const ext of exts) {
         const full = resolvedBase.endsWith('.js') || resolvedBase.endsWith('.ts') || resolvedBase.endsWith('.json') ? resolvedBase : resolvedBase + ext;
         if (fs.existsSync(full)) {
           traceImports(full, depth + 1);
           break;
         }
      }
    }
  }
  
  traceImports(entryFile);
  return { templatePath, files: Array.from(filesToRead) };
}

console.log(traceEndpointFiles('/home/rahult/Desktop/Nextest', '/api/runs/execute', 'POST'));
