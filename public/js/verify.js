/**
 * Home page: certificate checker.
 * Verifies a certificate number against the Google Sheet and lets the visitor
 * download the certificate. Also supports /?id=2026-1029-001 (from the QR code).
 */
$(function () {
  'use strict';

  var PATTERN = /^(\d{4}-\d{4}-\d{3,}|COA-\d{4}-\d{6})$/;
  var $input = $('#certNo');
  var currentNo = '';

  function setLoading(isLoading) {
    $('#verifyBtn').prop('disabled', isLoading);
    $('#spinner').toggleClass('d-none', !isLoading);
    $('#verifyText').text(isLoading ? 'Checking…' : 'Verify');
  }

  function clearResults() {
    $('#resultValid, #resultInvalid').addClass('d-none');
  }

  function showInvalid(message) {
    $('#resultValid').addClass('d-none');
    $('#resultInvalid').text(message).removeClass('d-none');
  }

  function showValid(record) {
    $('#resultInvalid').addClass('d-none');
    $('#vNo').text(record.certificateNo);
    $('#vName').text(record.fullName);
    // Certificates issued without an event show the organization instead of an event name
    var hasEvent = !!record.eventName;
    $('#vEventDt, #vEvent').toggleClass('d-none', !hasEvent);
    $('#vOrgDt, #vOrg').toggleClass('d-none', !record.organization);
    $('#vDateDt').text(hasEvent ? 'Event date' : 'Date');
    $('#vEvent').text(record.eventName || '');
    $('#vOrg').text(record.organization || '');
    $('#vEventDate').text(Cert.formatDate(record.eventDate));
    $('#vVenue').text(record.venue);
    $('#vIssued').text(Cert.formatDate(record.issueDate));
    $('#resultValid').removeClass('d-none');
  }

  /** Checks one certificate number against the server. */
  function verify(no) {
    currentNo = no;
    clearResults();
    setLoading(true);

    $.getJSON('/api/certificate/' + encodeURIComponent(no))
      .done(function (res) { showValid(res.data); })
      .fail(function (jqXHR, textStatus) {
        // 404 = not on record; anything else is a technical problem
        showInvalid(Cert.errorMessage(jqXHR, textStatus));
      })
      .always(function () { setLoading(false); });
  }

  /* ------------------------------ Form ------------------------------ */

  $('#verifyForm').on('submit', function (e) {
    e.preventDefault();
    var no = $.trim($input.val()).toUpperCase();
    $input.val(no);

    var valid = PATTERN.test(no);
    $input.toggleClass('is-invalid', !valid);
    $('#certNoError').toggleClass('d-none', valid);
    if (!valid) {
      clearResults();
      $input.trigger('focus');
      return;
    }

    // Keep the address bar shareable: /?id=2026-1029-001
    if (window.history && history.replaceState) history.replaceState(null, '', '/?id=' + encodeURIComponent(no));
    verify(no);
  });

  $input.on('input', function () {
    $input.removeClass('is-invalid');
    $('#certNoError').addClass('d-none');
  });

  /* ------------------------------ Download ------------------------------ */

  $('#downloadBtn').on('click', function () {
    var $btn = $(this).prop('disabled', true);
    $('#dlSpinner').removeClass('d-none');
    $('#downloadText').text('Preparing certificate…');

    Cert.getForPdf('/api/certificate/' + encodeURIComponent(currentNo) + '?download=pdf')
      .done(function (data, textStatus, jqXHR) {
        var blob = data instanceof Blob ? data : new Blob([data], { type: 'application/pdf' });
        Cert.downloadBlob(blob, Cert.getFilename(jqXHR, currentNo + '.pdf'));
        Cert.showToast('Certificate downloaded.', 'success');
      })
      .fail(function (jqXHR, textStatus) {
        Cert.showToast(Cert.errorMessage(jqXHR, textStatus), 'danger');
      })
      .always(function () {
        $btn.prop('disabled', false);
        $('#dlSpinner').addClass('d-none');
        $('#downloadText').text('Download certificate (PDF)');
      });
  });

  /* ------------------------------ From QR link ------------------------------ */

  var fromUrl = new URLSearchParams(window.location.search).get('id');
  if (fromUrl) {
    $input.val(fromUrl.toUpperCase());
    $('#verifyForm').trigger('submit');
  }
});
