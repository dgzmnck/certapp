/**
 * Helpers shared by the admin and event pages: toasts, date formatting,
 * PDF-aware AJAX and file download.
 */
window.Cert = (function ($) {
  'use strict';

  var lastBlobUrl = null;

  /** Shows a Bootstrap toast ('success' | 'danger' | 'warning'). */
  function showToast(message, type) {
    var $toast = $(
      '<div class="toast align-items-center text-bg-' + type + ' border-0" role="alert">' +
        '<div class="d-flex"><div class="toast-body"></div>' +
        '<button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>' +
        '</div></div>'
    );
    $toast.find('.toast-body').text(message);
    $('#toastContainer').append($toast);
    var toast = new bootstrap.Toast($toast[0], { delay: type === 'success' ? 5000 : 8000 });
    $toast.on('hidden.bs.toast', function () { $toast.remove(); });
    toast.show();
  }

  /** "2026-10-29" -> "October 29, 2026" */
  function formatDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!m) return iso || '';
    return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric'
    });
  }

  /** Best error message from a failed jqXHR. */
  function errorMessage(jqXHR, textStatus) {
    var body = jqXHR.responseJSON || {};
    if (body.message) return body.message;
    if (textStatus === 'timeout') return 'The request took too long. Please try again.';
    if (jqXHR.status === 0) return 'Cannot reach the server. Check your connection.';
    return 'Something went wrong. Please try again.';
  }

  /**
   * Runs an AJAX request that returns either a PDF (received as a Blob) or a
   * JSON error (received as text). The response type is chosen when the
   * headers arrive.
   */
  function pdfRequest(options) {
    return $.ajax($.extend({
      timeout: 90000,
      xhr: function () {
        var xhr = new XMLHttpRequest();
        xhr.addEventListener('readystatechange', function () {
          if (xhr.readyState === 2) {
            var type = xhr.getResponseHeader('Content-Type') || '';
            xhr.responseType = type.indexOf('application/pdf') === 0 ? 'blob' : 'text';
          }
        });
        return xhr;
      }
    }, options));
  }

  function postForPdf(url, payload) {
    return pdfRequest({
      url: url,
      method: 'POST',
      contentType: 'application/json',
      data: JSON.stringify(payload)
    });
  }

  function getForPdf(url) {
    return pdfRequest({ url: url, method: 'GET' });
  }

  function getFilename(jqXHR, fallback) {
    var header = jqXHR.getResponseHeader('Content-Disposition') || '';
    var match = /filename="?([^";]+)"?/i.exec(header);
    return match ? match[1] : fallback;
  }

  /** Starts a browser download and returns the object URL (for "download again"). */
  function downloadBlob(blob, filename) {
    if (lastBlobUrl) URL.revokeObjectURL(lastBlobUrl);
    lastBlobUrl = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = lastBlobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    return lastBlobUrl;
  }

  /** Marks server-side field errors on a form. */
  function applyFieldErrors($form, fields) {
    $.each(fields || {}, function (name, message) {
      var $input = $form.find('[name="' + name + '"]');
      $input.addClass('is-invalid');
      $input.siblings('.invalid-feedback').text(message);
    });
  }

  return {
    showToast: showToast,
    formatDate: formatDate,
    errorMessage: errorMessage,
    postForPdf: postForPdf,
    getForPdf: getForPdf,
    getFilename: getFilename,
    downloadBlob: downloadBlob,
    applyFieldErrors: applyFieldErrors
  };
})(jQuery);
