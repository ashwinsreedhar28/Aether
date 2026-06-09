/**
 * Maps file extensions to Monaco Editor language identifiers
 */
export function getLanguageFromPath(filePath: string): string {
  const extension = filePath.split('.').pop()?.toLowerCase() || '';

  const languageMap: Record<string, string> = {
    // JavaScript/TypeScript
    js: 'javascript',
    jsx: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    mjs: 'javascript',
    cjs: 'javascript',

    // Web
    html: 'html',
    htm: 'html',
    css: 'css',
    scss: 'scss',
    sass: 'sass',
    less: 'less',

    // Data formats
    json: 'json',
    xml: 'xml',
    yaml: 'yaml',
    yml: 'yaml',
    toml: 'toml',

    // Markdown
    md: 'markdown',
    markdown: 'markdown',

    // Python
    py: 'python',
    pyw: 'python',
    pyx: 'python',

    // Shell
    sh: 'shell',
    bash: 'shell',
    zsh: 'shell',

    // C-family
    c: 'c',
    h: 'c',
    cpp: 'cpp',
    cc: 'cpp',
    cxx: 'cpp',
    hpp: 'cpp',
    cs: 'csharp',

    // Java
    java: 'java',

    // Go
    go: 'go',

    // Rust
    rs: 'rust',

    // Ruby
    rb: 'ruby',

    // PHP
    php: 'php',

    // SQL
    sql: 'sql',

    // Other
    txt: 'plaintext',
    text: 'plaintext',
    log: 'plaintext',
    graphql: 'graphql',
    gql: 'graphql',
    dockerfile: 'dockerfile',
    Dockerfile: 'dockerfile',
  };

  return languageMap[extension] || 'plaintext';
}
