/* ui.js — DOM helpers, formatting, and the toast / bottom-sheet primitives. */
(function (global) {
  'use strict';

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function num(n, places) {
    if (n == null || isNaN(n)) return '–';
    return Number(n).toFixed(places == null ? 1 : places);
  }

  // Fold accents and punctuation so "stutzle" finds "Tim Stützle" and
  // "oreilly" finds "Ryan O'Reilly".
  function normalize(s) {
    return String(s)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '');
  }

  /* ---------------------------------------------------------------- toast */

  var toastTimer = null;

  function showToast(message, undoLabel, onUndo) {
    var toast = $('#toast');
    var text = $('#toastText');
    var undo = $('#toastUndo');

    text.textContent = message;
    if (onUndo) {
      undo.hidden = false;
      undo.textContent = undoLabel || 'Undo';
      undo.onclick = function () {
        hideToast();
        onUndo();
      };
    } else {
      undo.hidden = true;
      undo.onclick = null;
    }

    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, 4500);
  }

  function hideToast() {
    clearTimeout(toastTimer);
    var toast = $('#toast');
    if (toast) toast.hidden = true;
  }

  /* ---------------------------------------------------------------- sheet */

  var sheetOnClose = null;

  function openSheet(title, subtitle, buildBody, onClose) {
    $('#sheetName').textContent = title;
    $('#sheetSub').textContent = subtitle || '';
    var body = $('#sheetBody');
    body.innerHTML = '';
    buildBody(body);
    $('#sheetBackdrop').hidden = false;
    $('#draftSheet').hidden = false;
    sheetOnClose = onClose || null;
  }

  function closeSheet() {
    $('#sheetBackdrop').hidden = true;
    $('#draftSheet').hidden = true;
    $('#sheetBody').innerHTML = '';
    var cb = sheetOnClose;
    sheetOnClose = null;
    if (cb) cb();
  }

  function sheetIsOpen() {
    return !$('#draftSheet').hidden;
  }

  global.UI = {
    $: $,
    $$: $$,
    el: el,
    num: num,
    normalize: normalize,
    showToast: showToast,
    hideToast: hideToast,
    openSheet: openSheet,
    closeSheet: closeSheet,
    sheetIsOpen: sheetIsOpen
  };
})(window);
