/* 小果 · 语义检索用的最小 BERT 前端：WordPiece 分词 + 向量归一化
   目标是跟 HF 的 BertTokenizerFast 逐 token 对齐，不引第三方库。 */
(function (root) {
  "use strict";

  var CJKRE = "[\\u4E00-\\u9FFF\\u3400-\\u4DBF\\uF900-\\uFAFF]";

  function isSpace(c) { return c === 9 || c === 10 || c === 13 || c === 32 || c === 160; }

  function isCJK(ch) {
    var c = ch.codePointAt(0);
    return (c >= 0x4E00 && c <= 0x9FFF) || (c >= 0x3400 && c <= 0x4DBF) || (c >= 0xF900 && c <= 0xFAFF);
  }

  /* BertBasicTokenizer 里的 _is_punctuation：ASCII 标点 + 全角/中文标点，数字字母不算 */
  function isPunct(ch) {
    var c = ch.codePointAt(0);
    if ((c >= 33 && c <= 47) || (c >= 58 && c <= 64) || (c >= 91 && c <= 96) || (c >= 123 && c <= 126)) return true;
    if (c >= 0x2000 && c <= 0x206F) return true;
    if (c >= 0x3000 && c <= 0x303F) return true;
    if (c >= 0xFF00 && c <= 0xFFEF) return true;
    if (c >= 0x2010 && c <= 0x2027) return true;
    return false;
  }

  /* BertNormalizer：清控制字符 → 中文两侧加空格 → 空白归一 */
  function normalize(text) {
    var out = text.replace(/[\u0000\uFFFD]/g, "").replace(/\s/g, " ");
    out = out.replace(new RegExp("(" + CJKRE + ")", "g"), " $1 ");
    return out.replace(/ {2,}/g, " ").trim();
  }

  /* BertBasicTokenizer：按空白切，再把标点单独切出来 */
  function basic(text) {
    var words = [], cur = "";
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (isSpace(ch.charCodeAt(0))) {
        if (cur) { words.push(cur); cur = ""; }
        continue;
      }
      if (isPunct(ch)) {
        if (cur) { words.push(cur); cur = ""; }
        words.push(ch);
        continue;
      }
      cur += ch;
    }
    if (cur) words.push(cur);
    return words;
  }

  function BgeTokenizer(vocabText) {
    var vocab = new Map();
    var lines = vocabText.split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].length) vocab.set(lines[i], i);
    }
    this.vocab = vocab;
    this.cls = vocab.get("[CLS]") || 101;
    this.sep = vocab.get("[SEP]") || 102;
    this.unk = vocab.get("[UNK]") || 100;
    this.maxLen = 512;
  }

  BgeTokenizer.prototype.wordpiece = function (word) {
    var ids = [], start = 0;
    while (start < word.length) {
      var end = word.length, found = null;
      while (start < end) {
        var piece = (start > 0 ? "##" : "") + word.substring(start, end);
        if (this.vocab.has(piece)) { found = this.vocab.get(piece); break; }
        end--;
      }
      if (found === null) return [this.unk];
      ids.push(found);
      start = end;
    }
    return ids;
  };

  BgeTokenizer.prototype.encode = function (text, maxLen) {
    var norm = normalize(text);
    var words = basic(norm);
    var ids = [];
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      /* 单字符标点直接查表，其余走 wordpiece */
      if (w.length === 1 && this.vocab.has(w)) { ids.push(this.vocab.get(w)); continue; }
      var sub = this.wordpiece(w);
      for (var k = 0; k < sub.length; k++) ids.push(sub[k]);
    }
    var lim = (maxLen || this.maxLen) - 2;
    if (ids.length > lim) ids = ids.slice(0, lim);
    return [this.cls].concat(ids, [this.sep]);
  };

  root.BgeTok = { normalize: normalize, basic: basic, create: function (t) { return new BgeTokenizer(t); } };
})(typeof module !== "undefined" && module.exports ? module.exports : window);
