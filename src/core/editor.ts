/**
 * 批量编辑封装：把多次 insert / replace 收集到一次 WorkspaceEdit，最后统一 apply；
 * 短数组访问回退空串，避免越界崩溃。
 */
import * as vscode from 'vscode';

/**
 * WorkspaceEdit 的链式门面：收集对一个文档的全部编辑后一次性原子应用。
 * 同一实例 apply 后会重置内部编辑集，可安全复用。
 */
export default class Editor {
  private _edit = new vscode.WorkspaceEdit();

  constructor(private _uri: vscode.Uri) {}

  /**
   * 单点插入；另有批量（positions + texts）与行列数字重载。
   * 所有编辑先收集到内部 WorkspaceEdit，apply() 时一次性原子提交。
   */
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
        const text = Array.isArray(second) ? (second[index] ?? '') : (second as string);
        this._edit.insert(this._uri, position, text);
      }
    } else if (typeof first === 'number' && typeof second === 'number') {
      this._edit.insert(this._uri, new vscode.Position(first, second), third ?? '');
    }
    return this;
  }

  /**
   * 区间替换；另有批量（ranges + texts）与「起止 Position / 行列数字」重载，
   * 均按原文档坐标收集，apply() 时统一提交。
   */
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
      this._edit.replace(this._uri, first, second);
    } else if (Array.isArray(first)) {
      for (const [index, item] of first.entries()) {
        const text = Array.isArray(second) ? (second[index] ?? '') : (second as string);
        this._edit.replace(this._uri, item, text);
      }
    } else if (first instanceof vscode.Position && second instanceof vscode.Position && typeof third === 'string') {
      this._edit.replace(this._uri, new vscode.Range(first, second), third);
    } else if (
      typeof first === 'number' &&
      typeof second === 'number' &&
      typeof third === 'number' &&
      typeof fourth === 'number'
    ) {
      this._edit.replace(this._uri, new vscode.Range(first, second, third, fourth), fifth ?? '');
    }
    return this;
  }

  public async apply(): Promise<boolean> {
    const success = await vscode.workspace.applyEdit(this._edit);
    this._edit = new vscode.WorkspaceEdit();
    if (!success) {
      // 重叠编辑/文档并发变更会让 applyEdit 静默失败，这里同时提示用户，
      // 避免多光标包裹/解构等场景表现为"点了没反应"
      console.warn('[zeta] applyEdit 失败，可能存在重叠的编辑范围或文档已变更');
      vscode.window.showWarningMessage('zeta: 编辑未应用，可能存在重叠的编辑范围或文档已变更');
    }
    return success;
  }
}
