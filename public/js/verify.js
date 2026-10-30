/**
 * Home page: certificate checker.
 * Verifies a certificate number and recipient name, and supports prefilled QR links.
 */
$(function () {
  'use strict';

  var PATTERN = /^(\d{4}-\d{4}-\d{3,}|COA-\d{4}-\d{6})$/;
  var $input = $('#certNo');
  var $nameInput = $('#certName');
  var currentNo = '';
  var currentName = '';

  $.getJSON('/api/branding')
    .done(function (res) {
      var branding = res.data || {};
      if (!branding.issuerName && !branding.issuerAddress) return;
      $('#issuerName').text(branding.issuerName || '');
      $('#issuerAddress').text(branding.issuerAddress || '').toggleClass('d-none', !branding.issuerAddress);
      $('#verifierIssuer').removeClass('d-none');
    })
    .fail(function (jqXHR, textStatus) {
      console.error('Could not load issuer branding:', Cert.errorMessage(jqXHR, textStatus));
    });

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
  function verify(no, name) {
    currentNo = no;
    currentName = name;
    clearResults();
    setLoading(true);

    $.getJSON('/api/certificate/' + encodeURIComponent(no), { name: name })
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
    var name = $.trim($nameInput.val());
    $input.val(no);
    $nameInput.val(name);

    var validNo = PATTERN.test(no);
    var validName = name.length >= 2 && name.length <= 120;
    $input.toggleClass('is-invalid', !validNo);
    $nameInput.toggleClass('is-invalid', !validName);
    $('#certNoError').toggleClass('d-none', validNo);
    $('#certNameError').toggleClass('d-none', validName);
    if (!validNo || !validName) {
      clearResults();
      (validNo ? $nameInput : $input).trigger('focus');
      return;
    }

    var query = new URLSearchParams({ id: no, name: name });
    if (window.history && history.replaceState) history.replaceState(null, '', '/?' + query.toString());
    verify(no, name);
  });

  $input.on('input', function () {
    $input.removeClass('is-invalid');
    $('#certNoError').addClass('d-none');
  });
  $nameInput.on('input', function () {
    $nameInput.removeClass('is-invalid');
    $('#certNameError').addClass('d-none');
  });

  /* ------------------------------ Download ------------------------------ */

  $('#downloadBtn').on('click', function () {
    var $btn = $(this).prop('disabled', true);
    $('#dlSpinner').removeClass('d-none');
    $('#downloadText').text('Preparing certificate…');

    Cert.getForPdf('/api/certificate/' + encodeURIComponent(currentNo) + '?' + new URLSearchParams({
      download: 'pdf',
      name: currentName
    }).toString())
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

  var params = new URLSearchParams(window.location.search);
  var fromUrl = params.get('id');
  var fromName = params.get('name');
  if (fromUrl) {
    $input.val(fromUrl.toUpperCase());
    if (fromName) {
      $nameInput.val(fromName);
      $('#verifyForm').trigger('submit');
    } else {
      $nameInput.trigger('focus');
    }
  }
});
