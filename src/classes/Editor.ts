import * as vscode from 'vscode';

export default class Editor implements vscode.Disposable {
  private _edit = new vscode.WorkspaceEdit();

  constructor(private _uri: vscode.Uri) {}

  public dispose(): void {
    // 留作后续销毁钩子
  }

  insert(position: vscode.Position, newText: string): this;
  insert(positions: vscode.Position[], newTexts: string[] | string): this;
  insert(line: number, character: number, newText: string): this;
  public insert(
    first: vscode.Position | vscode.Position[] | number,
    second: string | string[] | number,
    third?: string
  ): this {
    if (first instanceof vscode.Position && typeof second === 'string') {
      this._edit.insert(this._uri, first, second);
    } else if (Array.isArray(first)) {
      for (const [index, position] of first.entries()) {
        const text = Array.isArray(second) ? second[index] : (second as string);
        this._edit.insert(this._uri, position, text);
      }
    } else if (typeof first === 'number' && typeof second === 'number') {
      this._edit.insert(this._uri, new vscode.Position(first, second), third ?? '');
    }
    return this;
  }

  delete(range: vscode.Range): this;
  delete(ranges: vscode.Range[]): this;
  delete(startLine: number, startCharacter: number, endLine: number, endCharacter: number): this;
  public delete(first: vscode.Range | vscode.Range[] | number, second?: number, third?: number, fourth?: number): this {
    if (Array.isArray(first)) {
      for (const range of first) this._edit.delete(this._uri, range);
    } else if (typeof first === 'number' && second !== undefined && third !== undefined && fourth !== undefined) {
      this._edit.delete(this._uri, new vscode.Range(first, second, third, fourth));
    } else if (first instanceof vscode.Range) {
      this._edit.delete(this._uri, first);
    }
    return this;
  }

  replace(range: vscode.Range, newText: string): this;
  replace(ranges: vscode.Range[], newTexts: string[] | string): this;
  replace(startPosition: vscode.Position, endPosition: vscode.Position, newText: string): this;
  replace(startLine: number, startCharacter: number, endLine: number, endCharacter: number, newText: string): this;
  public replace(
    first: vscode.Range | vscode.Range[] | vscode.Position | number,
    second: string | string[] | vscode.Position | number,
    third?: number | string,
    fourth?: number,
    fifth?: string
  ): this {
    if (first instanceof vscode.Range && typeof second === 'string') {
      this.delete(first).insert(first.start, second);
    } else if (Array.isArray(first)) {
      for (const [index, item] of first.entries()) {
        const text = Array.isArray(second) ? second[index] : (second as string);
        this.delete(item).insert(item.start, text);
      }
    } else if (first instanceof vscode.Position && second instanceof vscode.Position && typeof third === 'string') {
      this.delete(new vscode.Range(first, second)).insert(first, third);
    } else if (
      typeof first === 'number' &&
      typeof second === 'number' &&
      typeof third === 'number' &&
      typeof fourth === 'number'
    ) {
      this.delete(new vscode.Range(first, second, third, fourth)).insert(first, second, fifth ?? '');
    }
    return this;
  }

  public async apply(): Promise<boolean> {
    const success = await vscode.workspace.applyEdit(this._edit);
    this.dispose();
    return success;
  }
}
