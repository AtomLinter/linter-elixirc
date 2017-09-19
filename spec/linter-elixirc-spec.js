'use babel';

import { join } from 'path';
import { remove } from 'fs-extra';
// eslint-disable-next-line no-unused-vars
import { it, fit, wait, beforeEach, afterEach } from 'jasmine-fix';

const { lint } = require('../lib/init.js').provideLinter();

const validPathElixirc = join(__dirname, 'fixtures', 'elixirc', 'valid.ex');
const warningPathElixirc = join(__dirname, 'fixtures', 'elixirc', 'warning.ex');
const errorMode1PathElixirc = join(__dirname, 'fixtures', 'elixirc', 'error-mode1.ex');
const errorMode2PathElixirc = join(__dirname, 'fixtures', 'elixirc', 'error-mode2.ex');
const exsFilePathElixirc = join(__dirname, 'fixtures', 'elixirc', 'script.exs');

const errorMode2PathMix = join(__dirname, 'fixtures', 'mix-proj', 'lib', 'error-mode2.ex');
const exsFilePathMix = join(__dirname, 'fixtures', 'mix-proj', 'lib', 'script.exs');

const mixBuildDirectory = join(__dirname, 'fixtures', 'mix-proj', '_build');
remove(mixBuildDirectory);

describe('The elixirc provider for Linter', () => {
  beforeEach(async () => {
    atom.workspace.destroyActivePaneItem();

    await atom.packages.activatePackage('linter-elixirc');
    await atom.packages.activatePackage('language-elixir');
  });

  describe('when not working inside a Mix project', () => {
    describe('and using the standard configuration', () => {
      it('works with mode 1 errors', async () => {
        const editor = await atom.workspace.open(errorMode1PathElixirc);
        const messages = await lint(editor);

        expect(messages.length).toBe(1);
        expect(messages[0].severity).toBe('error');
        expect(messages[0].html).not.toBeDefined();
        expect(messages[0].excerpt).toBe('(ArgumentError) Dangerous is not available');
        expect(messages[0].location.file).toBe(errorMode1PathElixirc);
        expect(messages[0].location.position).toEqual([[1, 0], [1, 32]]);
      });

      it('works with mode 2 errors', async () => {
        const editor = await atom.workspace.open(errorMode2PathElixirc);
        const messages = await lint(editor);

        expect(messages.length).toBe(1);
        expect(messages[0].severity).toBe('error');
        expect(messages[0].html).not.toBeDefined();
        expect(messages[0].excerpt).toBe('(CompileError) module Usefulness is not loaded and could not be found');
        expect(messages[0].location.file).toBe(errorMode2PathElixirc);
        expect(messages[0].location.position).toEqual([[3, 2], [3, 20]]);
      });

      it('works with warnings', async () => {
        const editor = await atom.workspace.open(warningPathElixirc);
        const messages = await lint(editor);

        expect(messages.length).toBe(1);
        expect(messages[0].severity).toBe('warning');
        expect(messages[0].html).not.toBeDefined();
        expect(messages[0].excerpt).toBe('variable "prepare_for_call" does not exist and is being expanded to "prepare_for_call()", please use parentheses to remove the ambiguity or change the variable name');
        expect(messages[0].location.file).toBe(warningPathElixirc);
        expect(messages[0].location.position).toEqual([[20, 4], [20, 20]]);
      });

      it('works with .exs files', async () => {
        const editor = await atom.workspace.open(exsFilePathElixirc);
        const messages = await lint(editor);

        expect(messages.length).toBe(1);
        expect(messages[0].severity).toBe('warning');
        expect(messages[0].html).not.toBeDefined();
        expect(messages[0].excerpt).toBe('function simple_function/0 is unused');
        expect(messages[0].location.file).toBe(exsFilePathElixirc);
        expect(messages[0].location.position).toEqual([[1, 2], [1, 25]]);
      });

      it('finds nothing wrong with a valid file', async () => {
        const editor = await atom.workspace.open(validPathElixirc);
        const messages = await lint(editor);

        expect(messages.length).toBe(0);
      });
    });
  });

  describe('when working inside a Mix project', () => {
    describe('and using the standard configuration', () => {
      it('works with mode 2 errors', async () => {
        const editor = await atom.workspace.open(errorMode2PathMix);
        const messages = await lint(editor);

        expect(messages.length).toBe(1);
        expect(messages[0].severity).toBe('error');
        expect(messages[0].html).not.toBeDefined();
        expect(messages[0].excerpt).toBe('(CompileError) Identicon.Image.__struct__/1 is undefined, cannot expand struct Identicon.Image');
        expect(messages[0].location.file).toBe(errorMode2PathMix);
        expect(messages[0].location.position).toEqual([[11, 4], [11, 30]]);
      });

      it('works with .exs files', async () => {
        const editor = await atom.workspace.open(exsFilePathMix);
        const messages = await lint(editor);

        expect(messages.length).toBe(1);
        expect(messages[0].severity).toBe('warning');
        expect(messages[0].html).not.toBeDefined();
        expect(messages[0].excerpt).toBe('function simple_function/0 is unused');
        expect(messages[0].location.file).toBe(exsFilePathMix);
        expect(messages[0].location.position).toEqual([[1, 2], [1, 25]]);
      });
    });
  });

  describe('when using the setting forceElixirc', () => {
    beforeEach(async () => {
      atom.config.set('linter-elixirc.forceElixirc', true);
    });

    it('works with warnings', async () => {
      const editor = await atom.workspace.open(errorMode2PathMix);
      const messages = await lint(editor);

      expect(messages.length).toBe(1);
      expect(messages[0].severity).toBe('error');
      expect(messages[0].html).not.toBeDefined();
      expect(messages[0].excerpt).toBe('(CompileError) Identicon.Image.__struct__/1 is undefined, cannot expand struct Identicon.Image');
      expect(messages[0].location.file).toBe(errorMode2PathMix);
      expect(messages[0].location.position).toEqual([[11, 4], [11, 30]]);
    });
  });
});
