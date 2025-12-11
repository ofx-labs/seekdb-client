import * as vscode from "vscode";
import { DatabaseProvider } from "./DatabaseProvider";

/**
 * CollectionHoverProvider - 为 getOrCreateCollection 的 name 参数提供 hover 提示和跳转功能
 */
export class CollectionHoverProvider implements vscode.HoverProvider {
  private databaseProvider: DatabaseProvider;

  constructor(databaseProvider: DatabaseProvider) {
    this.databaseProvider = databaseProvider;
  }

  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.Hover> {
    // 获取当前行的文本
    const line = document.lineAt(position.line);
    const lineText = line.text;
    const offset = document.offsetAt(position);

    // 检测是否是 getOrCreateCollection 的调用
    const collectionName = this.detectCollectionName(
      document,
      position,
      lineText,
      offset
    );

    if (!collectionName) {
      return null;
    }

    // 在集合名称前添加 c$v1 前缀

    const fullCollectionName = `c$v1$${collectionName}`;

    // 创建 hover 内容
    const markdown = new vscode.MarkdownString();
    markdown.isTrusted = true; // 允许执行命令

    // 添加说明文本
    markdown.appendMarkdown(`**Collection:** \`${collectionName}\`\n\n`);

    // 添加跳转按钮
    const commandUri = vscode.Uri.parse(
      `command:seekdb.openCollectionBrowser?${encodeURIComponent(
        JSON.stringify([fullCollectionName])
      )}`
    );
    markdown.appendMarkdown(
      `[$(link-external) 查看 Collection 列表](${commandUri})\n`
    );

    // 返回 hover 信息
    return new vscode.Hover(markdown);
  }

  /**
   * 检测当前位置是否是 getOrCreateCollection 的 name 参数
   * @returns 如果是，返回 collection name 的值；否则返回 null
   */
  private detectCollectionName(
    document: vscode.TextDocument,
    position: vscode.Position,
    lineText: string,
    offset: number
  ): string | null {
    // 匹配 getOrCreateCollection 函数调用
    // 支持格式：
    // - getOrCreateCollection({ name: "collectionName" })
    // - getOrCreateCollection({ name: 'collectionName' })
    // - getOrCreateCollection({ name: `collectionName` })
    // - getOrCreateCollection({ name: COLLECTION_NAME })
    // - db.getOrCreateCollection({ name: "collectionName" })
    // - await getOrCreateCollection({ name: "collectionName" })

    const functionPattern =
      /(?:await\s+)?(?:\w+\.)?getOrCreateCollection\s*\(/gi;
    let match: RegExpExecArray | null;

    // 从当前位置向前查找最近的 getOrCreateCollection 调用
    const textBeforePosition = document.getText(
      new vscode.Range(0, 0, position.line + 1, position.character)
    );

    // 找到所有匹配的函数调用
    const matches: Array<{ start: number; end: number }> = [];
    while ((match = functionPattern.exec(textBeforePosition)) !== null) {
      matches.push({
        start: match.index + match[0].length,
        end: textBeforePosition.length,
      });
    }

    if (matches.length === 0) {
      return null;
    }

    // 找到最接近当前位置的匹配
    const currentOffset = document.offsetAt(position);
    let closestMatch: { start: number; end: number } | null = null;
    let minDistance = Infinity;

    for (const m of matches) {
      const matchStart = m.start;
      const matchEnd = m.end;
      if (currentOffset >= matchStart && currentOffset <= matchEnd) {
        const distance = currentOffset - matchStart;
        if (distance < minDistance) {
          minDistance = distance;
          closestMatch = m;
        }
      }
    }

    if (!closestMatch) {
      return null;
    }

    // 提取第一个参数（对象）
    const functionStartOffset = closestMatch.start;
    const functionStartPos = document.positionAt(functionStartOffset);

    // 需要找到完整的函数调用，包括右括号
    // 从函数参数开始位置到文档末尾获取文本
    const endPos = new vscode.Position(document.lineCount, 0);
    const textAfterPosition = document.getText(
      new vscode.Range(functionStartPos, endPos)
    );

    // 找到第一个参数的结束位置（可能是逗号或右括号）
    const firstParamEnd = this.findFirstParameterEnd(textAfterPosition);
    if (firstParamEnd === -1) {
      return null;
    }

    const firstParamText = textAfterPosition.substring(0, firstParamEnd).trim();

    // 检查是否是对象字面量
    if (!firstParamText.trim().startsWith("{")) {
      return null;
    }

    // 从对象中提取 name 属性的值
    return this.extractNameFromObject(
      firstParamText,
      currentOffset - functionStartOffset
    );
  }

  /**
   * 找到第一个参数的结束位置
   */
  private findFirstParameterEnd(text: string): number {
    let depth = 0;
    let inString = false;
    let stringChar = "";
    let braceDepth = 0; // 对象大括号深度
    let parenDepth = 0; // 括号深度

    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const prevChar = i > 0 ? text[i - 1] : "";

      // 处理字符串
      if (!inString && (char === '"' || char === "'" || char === "`")) {
        inString = true;
        stringChar = char;
      } else if (inString && char === stringChar && prevChar !== "\\") {
        inString = false;
        stringChar = "";
      }

      if (!inString) {
        if (char === "{") {
          braceDepth++;
        } else if (char === "}") {
          braceDepth--;
          // 如果对象闭合且不在嵌套中，检查是否到达参数结束
          if (braceDepth === 0 && parenDepth === 0) {
            // 找到下一个逗号或右括号
            for (let j = i + 1; j < text.length; j++) {
              const nextChar = text[j];
              if (nextChar === ",") {
                return j;
              } else if (nextChar === ")") {
                return j;
              } else if (!/\s/.test(nextChar)) {
                // 非空白字符，说明还有其他内容
                break;
              }
            }
            return i + 1;
          }
        } else if (char === "(") {
          parenDepth++;
        } else if (char === ")") {
          if (parenDepth === 0 && braceDepth === 0) {
            return i;
          }
          parenDepth--;
        } else if (char === "," && braceDepth === 0 && parenDepth === 0) {
          return i;
        }
      }
    }

    return -1;
  }

  /**
   * 从对象字面量中提取 name 属性的值
   */
  private extractNameFromObject(
    objectText: string,
    currentOffsetInParam: number
  ): string | null {
    // 查找 name: 属性
    const namePattern = /\bname\s*:/g;
    let nameMatch: RegExpExecArray | null;

    while ((nameMatch = namePattern.exec(objectText)) !== null) {
      const nameKeyStart = nameMatch.index;
      const nameValueStart = nameMatch.index + nameMatch[0].length;

      // 跳过空白字符
      let valueStart = nameValueStart;
      while (
        valueStart < objectText.length &&
        /\s/.test(objectText[valueStart])
      ) {
        valueStart++;
      }

      if (valueStart >= objectText.length) {
        continue;
      }

      // 找到值的结束位置
      const valueEnd = this.findPropertyValueEnd(objectText, valueStart);
      if (valueEnd === -1) {
        continue;
      }

      const valueText = objectText.substring(valueStart, valueEnd).trim();

      // 检查当前位置是否在 name 属性的值范围内
      // currentOffsetInParam 是相对于参数开始位置的偏移
      if (
        currentOffsetInParam >= valueStart &&
        currentOffsetInParam <= valueEnd
      ) {
        // 提取值（去除引号）
        return this.extractStringValue(valueText);
      }
    }

    return null;
  }

  /**
   * 找到属性值的结束位置
   */
  private findPropertyValueEnd(text: string, start: number): number {
    if (start >= text.length) {
      return -1;
    }

    const firstChar = text[start];

    // 如果是字符串字面量
    if (firstChar === '"' || firstChar === "'" || firstChar === "`") {
      let inString = true;
      let escaped = false;
      for (let i = start + 1; i < text.length; i++) {
        const char = text[i];
        if (escaped) {
          escaped = false;
          continue;
        }
        if (char === "\\") {
          escaped = true;
          continue;
        }
        if (char === firstChar) {
          return i + 1;
        }
      }
      return -1;
    }

    // 如果是变量名或其他标识符
    // 找到下一个逗号、分号、右大括号或换行
    let braceDepth = 0;
    let parenDepth = 0;
    let inString = false;
    let stringChar = "";

    for (let i = start; i < text.length; i++) {
      const char = text[i];
      const prevChar = i > 0 ? text[i - 1] : "";

      if (!inString && (char === '"' || char === "'" || char === "`")) {
        inString = true;
        stringChar = char;
      } else if (inString && char === stringChar && prevChar !== "\\") {
        inString = false;
        stringChar = "";
      }

      if (!inString) {
        if (char === "{") {
          braceDepth++;
        } else if (char === "}") {
          if (braceDepth === 0) {
            return i;
          }
          braceDepth--;
        } else if (char === "(") {
          parenDepth++;
        } else if (char === ")") {
          if (parenDepth === 0) {
            return i;
          }
          parenDepth--;
        } else if (
          (char === "," || char === ";") &&
          braceDepth === 0 &&
          parenDepth === 0
        ) {
          return i;
        }
      }
    }

    return text.length;
  }

  /**
   * 从函数调用文本中提取第一个参数
   */
  private extractFirstParameter(functionCallText: string): string | null {
    // 移除函数名和左括号
    const paramText = functionCallText.trim();
    if (!paramText.startsWith("(")) {
      return null;
    }

    // 找到第一个参数的结束位置
    let depth = 0;
    let inString = false;
    let stringChar = "";
    let paramStart = 1; // 跳过左括号
    let paramEnd = -1;

    for (let i = 1; i < paramText.length; i++) {
      const char = paramText[i];
      const prevChar = i > 0 ? paramText[i - 1] : "";

      // 处理字符串
      if (!inString && (char === '"' || char === "'" || char === "`")) {
        inString = true;
        stringChar = char;
      } else if (inString && char === stringChar && prevChar !== "\\") {
        inString = false;
        stringChar = "";
      }

      if (!inString) {
        if (char === "(") {
          depth++;
        } else if (char === ")") {
          if (depth === 0) {
            paramEnd = i;
            break;
          }
          depth--;
        } else if (char === "," && depth === 0) {
          paramEnd = i;
          break;
        }
      }
    }

    if (paramEnd === -1) {
      paramEnd = paramText.length - 1; // 如果没有找到，使用最后一个字符（右括号前）
    }

    const firstParam = paramText.substring(paramStart, paramEnd).trim();
    return firstParam || null;
  }

  /**
   * 从参数文本中提取字符串值（去除引号）
   */
  private extractStringValue(paramText: string): string {
    // 去除首尾空白
    paramText = paramText.trim();

    // 如果是字符串字面量，去除引号
    if (
      (paramText.startsWith('"') && paramText.endsWith('"')) ||
      (paramText.startsWith("'") && paramText.endsWith("'")) ||
      (paramText.startsWith("`") && paramText.endsWith("`"))
    ) {
      return paramText.slice(1, -1);
    }

    // 如果是变量名，直接返回（可能需要进一步处理，但先这样）
    return paramText;
  }
}
