/*
 * Copyright (C) 2012 Google Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 * 1. Redistributions of source code must retain the above copyright
 * notice, this list of conditions and the following disclaimer.
 *
 * 2. Redistributions in binary form must reproduce the above
 * copyright notice, this list of conditions and the following disclaimer
 * in the documentation and/or other materials provided with the
 * distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY GOOGLE INC. AND ITS CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL GOOGLE INC.
 * OR ITS CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

/**
 * @unrestricted
 */
Sources.StyleSheetOutlineDialog = class extends UI.FilteredListWidget.Delegate {
  /**
   * @param {!Workspace.UISourceCode} uiSourceCode
   * @param {function(number, number)} selectItemCallback
   */
  constructor(uiSourceCode, selectItemCallback) {
    super([]);
    this._selectItemCallback = selectItemCallback;
    /** @type {!Array<!Common.FormatterWorkerPool.CSSRule>} */
    this._rules = [];
    Common.formatterWorkerPool.parseCSS(uiSourceCode.workingCopy(), (isLastChunk, rules) => {
      this._rules.push(...rules);
      this.refresh();
    });
  }

  /**
   * @param {!Workspace.UISourceCode} uiSourceCode
   * @param {function(number, number)} selectItemCallback
   */
  static show(uiSourceCode, selectItemCallback) {
    Sources.StyleSheetOutlineDialog._instanceForTests =
        new Sources.StyleSheetOutlineDialog(uiSourceCode, selectItemCallback);
    new UI.FilteredListWidget(Sources.StyleSheetOutlineDialog._instanceForTests).showAsDialog();
  }

  /**
   * @override
   * @return {number}
   */
  itemCount() {
    return this._rules.length;
  }

  /**
   * @override
   * @param {number} itemIndex
   * @return {string}
   */
  itemKeyAt(itemIndex) {
    var rule = this._rules[itemIndex];
    return rule.selectorText || rule.atRule;
  }

  /**
   * @override
   * @param {number} itemIndex
   * @param {string} query
   * @return {number}
   */
  itemScoreAt(itemIndex, query) {
    var rule = this._rules[itemIndex];
    return -rule.lineNumber;
  }

  /**
   * @override
   * @param {number} itemIndex
   * @param {string} query
   * @param {!Element} titleElement
   * @param {!Element} subtitleElement
   */
  renderItem(itemIndex, query, titleElement, subtitleElement) {
    var rule = this._rules[itemIndex];
    titleElement.textContent = rule.selectorText || rule.atRule;
    this.highlightRanges(titleElement, query);
    subtitleElement.textContent = ':' + (rule.lineNumber + 1);
  }

  /**
   * @override
   * @param {number} itemIndex
   * @param {string} promptValue
   */
  selectItem(itemIndex, promptValue) {
    var rule = this._rules[itemIndex];
    var lineNumber = rule.lineNumber;
    if (!isNaN(lineNumber) && lineNumber >= 0)
      this._selectItemCallback(lineNumber, rule.columnNumber);
  }
};
