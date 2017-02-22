'use babel';

// eslint-disable-next-line import/no-extraneous-dependencies, import/extensions
import { CompositeDisposable, Range } from 'atom';
import { find, rangeFromLineNumber, exec } from 'atom-linter';
import { dirname, join, relative, sep } from 'path';
import { existsSync, readFileSync, readdirSync } from 'fs';

const tmp = require('tmp');

// Internal values
const elixirProjectPathCache = new Map();
let elixircPath;
let mixPath;
let forceElixirc;

function regexp(string, flags) {
  return new RegExp(
    string
      .replace(/\\ /gm, 'randomstring123')
      .replace(/\s/gm, '')
      .replace(/randomstring123/gm, '\\ '),
    flags,
  );
}

// Find elixir project in the file path by locating mix.exs, otherwise
//  fallback to project path or file path
const findElixirProjectPath = async (editorPath) => {
  const editorDir = dirname(editorPath);
  const mixexsPath = find(editorDir, 'mix.exs');
  if (mixexsPath !== null) {
    return dirname(mixexsPath);
  }
  const projPath = atom.project.relativizePath(editorPath)[0];
  if (projPath !== null) {
    return projPath;
  }
  return editorDir;
};

// Memoize the project path per file (traversing is quite expensive)
const elixirProjectPath = async (textEditor) => {
  const editorPath = textEditor.getPath();
  if (elixirProjectPathCache.has(editorPath)) {
    return elixirProjectPathCache.get(editorPath);
  }
  const projectPath = await findElixirProjectPath(editorPath);
  elixirProjectPathCache.set(editorPath, projectPath);
  return projectPath;
};

const isMixProject = async (textEditor) => {
  const project = await elixirProjectPath(textEditor);
  return existsSync(join(project, 'mix.exs'));
};

const isTestFile = async (textEditor) => {
  const project = await elixirProjectPath(textEditor);
  const relativePath = relative(project, textEditor.getPath());
  // Is the first directory of the relative path "test"?
  return relativePath.split(sep)[0] === 'test';
};

const isForcedElixirc = () => forceElixirc;

const isExsFile = textEditor => textEditor.getPath().endsWith('.exs');

const isPhoenixProject = async (textEditor) => {
  const project = await elixirProjectPath(textEditor);
  const mixLockPath = join(project, 'mix.lock');
  try {
    const mixLockContent = readFileSync(mixLockPath, 'utf-8');
    return mixLockContent.indexOf('"phoenix"') > 0;
  } catch (error) {
    return false;
  }
};

const findTextEditor = (filePath) => {
  const allEditors = atom.workspace.getTextEditors();
  const matchingEditor = allEditors.find(
    textEditor => textEditor.getPath() === filePath);
  if (matchingEditor !== undefined) {
    return matchingEditor;
  }
  return false;
};

const parseError = async (toParse, textEditor) => {
  const messages = [];
  const re = regexp(
    `
    \\*\\*[\\ ]+
    \\((\\w+)\\)                   ${''/* 1 - (TypeOfError)*/}
    [\\ ](?:                       ${''/* Two message formats.... mode one*/}
      ([\\w\\ ]+)                  ${''/* 2 - Message*/}
      [\\r\\n]{1,2}.+[\\r\\n]{1,2} ${''/* Internal elixir code*/}
      [\\ ]+(.+)                   ${''/* 3 - File*/}
      :(\\d+):                     ${''/* 4 - Line*/}
    |                              ${''/* Or... mode two*/}
      (.+)                         ${''/* 5 - File*/}
      :(\\d+):                     ${''/* 6 - Line*/}
      [\\ ](.+)                    ${''/* 7 - Message*/}
    )
  `,
    'gm',
  );
  const projectPath = await elixirProjectPath(textEditor);
  let reResult = re.exec(toParse);
  while (reResult !== null) {
    let text;
    let filePath;
    let range;
    if (reResult[2] !== undefined) {
      text = `(${reResult[1]}) ${reResult[2]}`;
      filePath = join(projectPath, reResult[3]);
      const fileEditor = findTextEditor(filePath);
      if (fileEditor) {
        // If there is an open TextEditor instance for the file from the Error,
        // we can get a better range using rangeFromLineNumber, otherwise
        // generate a 1 character range that can be updated to a proper range
        // if/when the file is opened.
        range = rangeFromLineNumber(fileEditor, reResult[4] - 1);
      } else {
        range = new Range([reResult[4] - 1, 0], [reResult[4] - 1, 1]);
      }
    } else {
      text = `(${reResult[1]}) ${reResult[7]}`;
      filePath = join(projectPath, reResult[5]);
      const fileEditor = findTextEditor(filePath);
      if (fileEditor) {
        range = rangeFromLineNumber(fileEditor, reResult[6] - 1);
      } else {
        range = new Range([reResult[6] - 1, 0], [reResult[6] - 1, 1]);
      }
    }
    messages.push({
      type: 'Error',
      text,
      filePath,
      range,
    });
    reResult = re.exec(toParse);
  }
  return messages;
};

// Only Elixir 1.3+
const parseWarning = async (toParse, textEditor) => {
  const messages = [];
  const re = regexp(
    `
    warning:\\ (.*)\\n  ${''/* warning */}
    \\ \\ (.*):([0-9]+) ${''/* file and file number */}
    `,
    'g',
  );
  const projectPath = await elixirProjectPath(textEditor);
  let reResult = re.exec(toParse);

  while (reResult != null) {
    const filePath = join(projectPath, reResult[2]);
    try {
      let range;
      const fileEditor = findTextEditor(filePath);
      if (fileEditor) {
        range = rangeFromLineNumber(fileEditor, reResult[3] - 1);
      } else {
        range = new Range([reResult[3] - 1, 0], [reResult[3] - 1, 1]);
      }
      messages.push({
        type: 'Warning',
        text: reResult[1],
        filePath,
        range,
      });
    } catch (Error) {
      // eslint-disable-next-line no-console
      console.error('linter-elixirc:', Error);
    }
    reResult = re.exec(toParse);
  }
  return messages;
};

// Parses warning for elixir 1.2 and below
const parseLegacyWarning = async (toParse, textEditor) => {
  const messages = [];
  const re = regexp(
    `
    ([^:\\n]*)   ${''/* 1 - File name */}
    :(\\d+)      ${''/* 2 - Line */}
    :\\ warning
    :\\ (.*)     ${''/* 3 - Message */}
    `,
    'g',
  );
  const projectPath = await elixirProjectPath(textEditor);
  let reResult = re.exec(toParse);
  while (reResult !== null) {
    const filePath = join(projectPath, reResult[1]);
    try {
      let range;
      const fileEditor = findTextEditor(filePath);
      if (fileEditor) {
        range = rangeFromLineNumber(fileEditor, reResult[3] - 1);
      } else {
        range = new Range([reResult[3] - 1, 0], [reResult[3] - 1, 1]);
      }
      messages.push({
        type: 'Warning',
        text: reResult[3],
        filePath,
        range,
      });
    } catch (Error) {
      // eslint-disable-next-line no-console
      console.error('linter-elixirc:', Error);
    }
    reResult = re.exec(toParse);
  }
  return messages;
};

const handleResult = async (compileResult, textEditor) => {
  const resultString = `${compileResult.stdout}\n${compileResult.stderr}`;
  try {
    const errorStack = await parseError(resultString, textEditor);
    const warningStack = await parseWarning(resultString, textEditor);
    const legacyWarningStack = await parseLegacyWarning(resultString, textEditor);
    return errorStack.concat(warningStack).concat(legacyWarningStack)
      .filter(error => error !== null)
      .map(error => error);
  } catch (Error) {
    // eslint-disable-next-line no-console
    console.error('linter-elixirc:', Error);
    return []; // Error is in a different file, just suppress
  }
};

const getOpts = async textEditor => ({
  cwd: await elixirProjectPath(textEditor),
  throwOnStdErr: false,
  stream: 'both',
  allowEmptyStderr: true,
});

const getDepsPa = async (textEditor) => {
  const env = (await isTestFile(textEditor)) ? 'test' : 'dev';
  const buildDir = join('_build', env, 'lib');
  const projectPath = await elixirProjectPath(textEditor);
  try {
    return readdirSync(join(projectPath, buildDir))
      .map(
        item =>
          join(projectPath, buildDir, item, 'ebin'),
      );
  } catch (e) {
    return [];
  }
};

const lintElixirc = async (textEditor) => {
  const tempDir = tmp.dirSync({ unsafeCleanup: true });
  const elixircArgs = [
    '--ignore-module-conflict',
    '--app',
    'mix',
    '--app',
    'ex_unit',
    '-o',
    tempDir.name,
  ];
  const paDeps = await getDepsPa(textEditor);
  paDeps.forEach((item) => {
    elixircArgs.push('-pa', item);
  });
  elixircArgs.push(textEditor.getPath());

  const fileText = textEditor.getText();
  const execOpts = await getOpts(textEditor);
  const result = await exec(elixircPath, elixircArgs, execOpts);
  // Cleanup the temp dir
  tempDir.removeCallback();
  if (textEditor.getText() !== fileText) {
    // File contents have changed since the run was triggered, don't update messages
    return null;
  }
  return handleResult(result, textEditor);
};

const lintMix = async (textEditor) => {
  const fileText = textEditor.getText();
  const execOpts = await getOpts(textEditor);
  const result = await exec(mixPath, ['compile'], execOpts);
  if (textEditor.getText() !== fileText) {
    // File contents have changed since the run was triggered, don't update messages
    return null;
  }
  return handleResult(result, textEditor);
};

export default {
  activate() {
    require('atom-package-deps').install('linter-elixirc');

    this.subscriptions = new CompositeDisposable();
    this.subscriptions.add(
      atom.config.observe('linter-elixirc.elixircPath', (value) => {
        elixircPath = value;
      }),
    );
    this.subscriptions.add(
      atom.config.observe('linter-elixirc.mixPath', (value) => {
        mixPath = value;
      }),
    );
    this.subscriptions.add(
      atom.config.observe('linter-elixirc.forceElixirc', (value) => {
        forceElixirc = value;
      }),
    );
  },

  deactivate() {
    this.subscriptions.dispose();
  },

  provideLinter() {
    return {
      grammarScopes: ['source.elixir'],
      scope: 'project',
      lintOnFly: false,
      name: 'Elixir',
      async lint(textEditor) {
        if (
          isForcedElixirc() ||
            !(await isMixProject(textEditor)) ||
            isExsFile(textEditor) ||
            (await isPhoenixProject(textEditor))
        ) {
          return lintElixirc(textEditor);
        }
        return lintMix(textEditor);
      },
    };
  },
};
