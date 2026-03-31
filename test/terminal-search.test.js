import { describe, it, expect } from 'vitest';

const {
  translateBufferLineToStringWithWrap,
  stringLengthToBufferSize,
  collectTerminalSearchMatches
} = require('../src/terminal-search');

class MockCell {
  constructor(chars, width = 1, code) {
    this._chars = chars;
    this._width = width;
    this._code = code ?? (chars ? chars.codePointAt(chars.length - 1) : 0);
  }

  getChars() {
    return this._chars;
  }

  getWidth() {
    return this._width;
  }

  getCode() {
    return this._code;
  }
}

class MockLine {
  constructor(cells, isWrapped = false) {
    this._cells = cells;
    this.isWrapped = isWrapped;
    this.length = cells.length;
  }

  getCell(index) {
    return this._cells[index];
  }

  translateToString(trimRight) {
    let value = '';
    for (const cell of this._cells) {
      if (cell.getWidth() === 0) continue;
      value += cell.getCode() === 0 ? ' ' : (cell.getChars() || ' ');
    }
    return trimRight ? value.replace(/\s+$/, '') : value;
  }
}

class MockBuffer {
  constructor(lines) {
    this._lines = lines;
    this.length = lines.length;
  }

  getLine(index) {
    return this._lines[index];
  }
}

describe('terminal search helpers', () => {
  it('joins wrapped buffer rows into one searchable logical line', () => {
    const buffer = new MockBuffer([
      new MockLine([new MockCell('a'), new MockCell('b'), new MockCell('c')]),
      new MockLine([new MockCell('d'), new MockCell('e'), new MockCell('f')], true)
    ]);

    expect(translateBufferLineToStringWithWrap(buffer, 0, true)).toEqual([
      'abcdef',
      [0, 3]
    ]);
    expect(translateBufferLineToStringWithWrap(buffer, 1, true)).toEqual([
      'def',
      [0]
    ]);
  });

  it('maps string offsets to real buffer columns for wide characters', () => {
    const buffer = new MockBuffer([
      new MockLine([
        new MockCell('界', 2),
        new MockCell('', 0, 0),
        new MockCell('a', 1),
        new MockCell('b', 1)
      ])
    ]);

    expect(stringLengthToBufferSize(buffer, 0, 1)).toBe(2);
    expect(collectTerminalSearchMatches(buffer, 4, 'ab')).toEqual([
      {
        preview: '界ab',
        beforeText: '界',
        matchText: 'ab',
        afterText: '',
        row: 0,
        col: 2,
        length: 2
      }
    ]);
  });

  it('finds matches that span wrapped rows in the full buffer', () => {
    const buffer = new MockBuffer([
      new MockLine([new MockCell('x'), new MockCell('y'), new MockCell('z')]),
      new MockLine([new MockCell('h'), new MockCell('e'), new MockCell('l')]),
      new MockLine([new MockCell('l'), new MockCell('o'), new MockCell(' ')], true),
      new MockLine([new MockCell('w'), new MockCell('o'), new MockCell('r')], true),
      new MockLine([new MockCell('l'), new MockCell('d'), new MockCell('!')], true)
    ]);

    expect(collectTerminalSearchMatches(buffer, 3, 'world')).toEqual([
      {
        preview: 'hello world!',
        beforeText: 'hello ',
        matchText: 'world',
        afterText: '!',
        row: 3,
        col: 0,
        length: 5
      }
    ]);
  });

  it('does not extend a match into the next row when it ends at a wrap boundary', () => {
    const buffer = new MockBuffer([
      new MockLine([new MockCell('a'), new MockCell('b'), new MockCell('c')]),
      new MockLine([new MockCell('d'), new MockCell('e'), new MockCell('f')], true)
    ]);

    expect(collectTerminalSearchMatches(buffer, 3, 'abc')).toEqual([
      {
        preview: 'abcdef',
        beforeText: '',
        matchText: 'abc',
        afterText: 'def',
        row: 0,
        col: 0,
        length: 3
      }
    ]);
  });
});
