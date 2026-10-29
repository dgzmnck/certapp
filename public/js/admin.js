/** Admin page: sign in, create events, show/download QR codes, open/close events. */
$(function () {
  'use strict';

  var qrModal = new bootstrap.Modal('#qrModal');
  var recipModal = new bootstrap.Modal('#recipModal');
  var events = []; // last list loaded from the server
  var signatories = [];
  var purposeTemplates = [];

  /* ------------------------------ Views ------------------------------ */

  function showLogin() {
    $('#dashView').addClass('d-none');
    $('#loginView').removeClass('d-none');
    $('#username').trigger('focus');
  }

  function showDashboard() {
    $('#loginView').addClass('d-none');
    $('#dashView').removeClass('d-none');
    loadEvents();
    loadSignatories();
    loadPurposeTemplates();
  }

  // Decide which view to show
  $.getJSON('/api/admin/me')
    .done(function (res) { return res.authenticated ? showDashboard() : showLogin(); })
    .fail(showLogin);

  $('#adminNav').on('click', '.nav-link', function () {
    var panelId = $(this).data('panel');
    $('#adminNav .nav-link').removeClass('active');
    $(this).addClass('active');
    $('.admin-panel').prop('hidden', true);
    $('#' + panelId).prop('hidden', false);
  });

  // Any 401 from the API means the session expired
  $(document).ajaxError(function (e, jqXHR, settings) {
    if (jqXHR.status === 401 && settings.url.indexOf('/api/admin/login') === -1) {
      Cert.showToast('Your session expired. Please sign in again.', 'warning');
      showLogin();
    }
  });

  /* ------------------------------ Login ------------------------------ */

  $('#loginForm').on('submit', function (e) {
    e.preventDefault();
    var $btn = $('#loginBtn').prop('disabled', true);
    $('#loginError').addClass('d-none');

    $.ajax({
      url: '/api/admin/login',
      method: 'POST',
      contentType: 'application/json',
      data: JSON.stringify({ username: $('#username').val(), password: $('#password').val() })
    })
      .done(function () {
        $('#password').val('');
        showDashboard();
      })
      .fail(function (jqXHR, textStatus) {
        $('#loginError').text(Cert.errorMessage(jqXHR, textStatus)).removeClass('d-none');
      })
      .always(function () { $btn.prop('disabled', false); });
  });

  $('#logoutBtn').on('click', function () {
    $.ajax({ url: '/api/admin/logout', method: 'POST' }).always(function () {
      events = [];
      $('#eventRows').empty();
      showLogin();
    });
  });

  /* ------------------------------ Events list ------------------------------ */

  function statusBadge(status) {
    var open = status === 'Active';
    return $('<span class="badge rounded-pill">')
      .addClass(open ? 'text-bg-success' : 'text-bg-secondary')
      .text(status === 'Inactive' ? 'Inactive' : (open ? 'Open' : 'Closed'));
  }

  function renderEvents() {
    var $body = $('#eventRows').empty();
    $('#loadingMsg').addClass('d-none');
    $('#emptyMsg').toggleClass('d-none', events.length > 0);

    events.forEach(function (ev) {
      var open = ev.status === 'Active';
      var $row = $('<tr>').attr('data-id', ev.eventId);

      $row.append($('<td class="fw-semibold">').text(ev.eventName));
      $row.append($('<td>').text(Cert.formatDate(ev.eventDate)));
      $row.append($('<td>').text(ev.venue));
      $row.append($('<td>').append(statusBadge(ev.status)));

      var $actions = $('<td class="text-end text-nowrap">');
      $actions.append(
        eventSignatorySelect(ev),
        $('<button type="button" class="btn btn-outline-primary btn-sm me-1 js-save-event-signatory">').text('Save signatory'),
        $('<button type="button" class="btn btn-primary btn-sm me-1 js-qr">').text('QR code'),
        $('<button type="button" class="btn btn-outline-primary btn-sm me-1 js-recipients">').text('Recipients'),
        $('<button type="button" class="btn btn-outline-primary btn-sm js-toggle">').text(open ? 'Close' : 'Reopen')
      );
      $row.append($actions);
      $body.append($row);
    });
  }

  function loadEvents() {
    $('#loadingMsg').removeClass('d-none');
    $.getJSON('/api/admin/events')
      .done(function (res) {
        events = res.data;
        renderEvents();
      })
      .fail(function (jqXHR, textStatus) {
        $('#loadingMsg').addClass('d-none');
        if (jqXHR.status !== 401) Cert.showToast(Cert.errorMessage(jqXHR, textStatus), 'danger');
      });
  }

  function findEvent(id) {
    return events.filter(function (e) { return e.eventId === id; })[0];
  }

  /* ------------------------------ Create event ------------------------------ */

  var $form = $('#eventForm');

  $form.on('input change', '.is-invalid', function () { $(this).removeClass('is-invalid'); });

  $form.on('submit', function (e) {
    e.preventDefault();
    $form.find('.is-invalid').removeClass('is-invalid');
    $form.find('input').each(function () { this.value = $.trim(this.value); });

    if (!this.checkValidity()) {
      $form.addClass('was-validated');
      $form.find(':invalid').first().trigger('focus');
      return;
    }
    $form.removeClass('was-validated');

    var $btn = $('#createBtn').prop('disabled', true);
    $('#createSpinner').removeClass('d-none');

    $.ajax({
      url: '/api/admin/events',
      method: 'POST',
      contentType: 'application/json',
      data: JSON.stringify({
        eventName: $('#eventName').val(),
        eventDate: $('#eventDate').val(),
        venue: $('#venue').val(),
        signatoryId: $('#eventSignatory').val(),
        certificateTitle: $('#certificateTitle').val()
      })
    })
      .done(function (res) {
        events.unshift(res.data);
        renderEvents();
        $form[0].reset();
        Cert.showToast('Event created.', 'success');
        openQr(res.data); // show the QR straight away
      })
      .fail(function (jqXHR, textStatus) {
        var body = jqXHR.responseJSON || {};
        if (body.details && body.details.fields) Cert.applyFieldErrors($form, body.details.fields);
        Cert.showToast(Cert.errorMessage(jqXHR, textStatus), 'danger');
      })
      .always(function () {
        $btn.prop('disabled', false);
        $('#createSpinner').addClass('d-none');
      });
  });

  /* ------------------------------ Signatories ------------------------------ */

  function populateSignatorySelects() {
    ['#eventSignatory', '#purposeSignatory'].forEach(function (selector) {
      var $select = $(selector).empty();
      $select.append($('<option>').val('').text('Select signatory'));
      signatories.filter(function (item) { return item.status === 'Active'; }).forEach(function (item) {
        $select.append($('<option>').val(item.signatoryId).text(item.name + ' — ' + item.title));
      });
    });
  }

  function loadSignatories() {
    $('#signatoryLoading').removeClass('d-none');
    $.getJSON('/api/admin/signatories')
      .done(function (res) {
        signatories = res.data;
        populateSignatorySelects();
        renderEvents();
        renderSignatories();
      })
      .fail(function (jqXHR, textStatus) {
        $('#signatoryLoading').addClass('d-none');
        if (jqXHR.status !== 401) Cert.showToast(Cert.errorMessage(jqXHR, textStatus), 'danger');
      });
  }

  function eventSignatorySelect(ev) {
    var $select = $('<select class="form-select form-select-sm d-inline-block me-1 js-event-signatory">')
      .css('width', '160px')
      .attr('aria-label', 'Event signatory');
    $select.append($('<option>').val('').text('Select signatory'));
    signatories.forEach(function (item) {
      if (item.status === 'Active' || item.signatoryId === ev.signatoryId) {
        $select.append($('<option>').val(item.signatoryId)
          .text(item.name + (item.status === 'Active' ? '' : ' (Inactive)')));
      }
    });
    $select.val(ev.signatoryId || '');
    return $select;
  }

  function renderSignatories() {
    var $body = $('#signatoryRows').empty();
    $('#signatoryLoading').addClass('d-none');
    $('#signatoryEmpty').toggleClass('d-none', signatories.length > 0);
    signatories.forEach(function (item) {
      var active = item.status === 'Active';
      var $row = $('<tr>').attr('data-id', item.signatoryId);
      var $image = $('<img>').attr({ src: item.eSignature, alt: 'Signature of ' + item.name })
        .css({ maxWidth: '100px', maxHeight: '42px', objectFit: 'contain' });
      $row.append($('<td>').append($image));
      $row.append($('<td class="fw-semibold">').text(item.name));
      $row.append($('<td>').text(item.title));
      $row.append($('<td>').text(item.office));
      $row.append($('<td>').append(statusBadge(item.status)));
      $row.append($('<td class="text-end text-nowrap">').append(
        $('<button type="button" class="btn btn-outline-primary btn-sm me-1 js-edit-signatory">').text('Edit'),
        $('<button type="button" class="btn btn-outline-secondary btn-sm js-toggle-signatory">').text(active ? 'Deactivate' : 'Activate')
      ));
      $body.append($row);
    });
  }

  function resetSignatoryForm() {
    $('#signatoryForm')[0].reset();
    $('#signatoryId').val('');
    $('#eSignature').prop('required', true);
    $('#signatoryFormTitle').text('Add signatory');
    $('#saveSignatoryBtn').text('Save signatory');
    $('#cancelSignatoryEdit').addClass('d-none');
    $('#signatoryForm').removeClass('was-validated').find('.is-invalid').removeClass('is-invalid');
  }

  $('#cancelSignatoryEdit').on('click', resetSignatoryForm);

  $('#signatoryForm').on('submit', function (event) {
    event.preventDefault();
    var form = this;
    var id = $('#signatoryId').val();
    var file = $('#eSignature')[0].files[0];
    if (!id && !file) $('#eSignature').addClass('is-invalid');
    if (!form.checkValidity() || (!id && !file)) {
      $(form).addClass('was-validated');
      $(form).find(':invalid').first().trigger('focus');
      return;
    }

    var data = new FormData();
    data.append('name', $('#signatoryName').val());
    data.append('title', $('#signatoryTitle').val());
    data.append('office', $('#signatoryOffice').val());
    if (file) data.append('eSignature', file);
    $('#saveSignatoryBtn').prop('disabled', true);
    $.ajax({
      url: '/api/admin/signatories' + (id ? '/' + encodeURIComponent(id) : ''),
      method: id ? 'PUT' : 'POST',
      data: data,
      processData: false,
      contentType: false
    })
      .done(function () {
        resetSignatoryForm();
        loadSignatories();
        Cert.showToast(id ? 'Signatory updated.' : 'Signatory added.', 'success');
      })
      .fail(function (jqXHR, textStatus) {
        var body = jqXHR.responseJSON || {};
        if (body.details && body.details.fields) Cert.applyFieldErrors($('#signatoryForm'), body.details.fields);
        Cert.showToast(Cert.errorMessage(jqXHR, textStatus), 'danger');
      })
      .always(function () { $('#saveSignatoryBtn').prop('disabled', false); });
  });

  $('#signatoryRows').on('click', '.js-edit-signatory', function () {
    var id = $(this).closest('tr').data('id');
    var item = signatories.filter(function (record) { return record.signatoryId === id; })[0];
    if (!item) return;
    $('#signatoryId').val(item.signatoryId);
    $('#signatoryName').val(item.name);
    $('#signatoryTitle').val(item.title);
    $('#signatoryOffice').val(item.office);
    $('#eSignature').prop('required', false).val('');
    $('#signatoryFormTitle').text('Edit signatory');
    $('#saveSignatoryBtn').text('Save changes');
    $('#cancelSignatoryEdit').removeClass('d-none');
    $('#signatoriesPanel').prop('hidden', false);
    $('#signatoryName').trigger('focus');
  });

  $('#signatoryRows').on('click', '.js-toggle-signatory', function () {
    var $button = $(this);
    var id = $button.closest('tr').data('id');
    var item = signatories.filter(function (record) { return record.signatoryId === id; })[0];
    if (!item) return;
    var next = item.status === 'Active' ? 'Inactive' : 'Active';
    $button.prop('disabled', true);
    $.ajax({
      url: '/api/admin/signatories/' + encodeURIComponent(id) + '/status',
      method: 'PATCH',
      contentType: 'application/json',
      data: JSON.stringify({ status: next })
    })
      .done(function () { loadSignatories(); Cert.showToast('Signatory ' + next.toLowerCase() + '.', 'success'); })
      .fail(function (jqXHR, textStatus) {
        $button.prop('disabled', false);
        Cert.showToast(Cert.errorMessage(jqXHR, textStatus), 'danger');
      });
  });

  /* ---------------------------- Purpose templates ---------------------------- */

  function loadPurposeTemplates() {
    $('#purposeLoading').removeClass('d-none');
    $.getJSON('/api/admin/purpose-templates')
      .done(function (res) {
        purposeTemplates = res.data;
        renderPurposeTemplates();
      })
      .fail(function (jqXHR, textStatus) {
        $('#purposeLoading').addClass('d-none');
        if (jqXHR.status !== 401) Cert.showToast(Cert.errorMessage(jqXHR, textStatus), 'danger');
      });
  }

  function renderPurposeTemplates() {
    var $body = $('#purposeRows').empty();
    $('#purposeLoading').addClass('d-none');
    $('#purposeEmpty').toggleClass('d-none', purposeTemplates.length > 0);
    purposeTemplates.forEach(function (template) {
      var active = template.status === 'Active';
      var $row = $('<tr>').attr('data-id', template.purposeId);
      $row.append($('<td>').text(template.eventPlace));
      $row.append($('<td>').text(Cert.formatDate(template.eventDate)));
      $row.append($('<td>').text(template.purpose));
      $row.append($('<td>').append(statusBadge(template.status)));
      $row.append($('<td class="text-end text-nowrap">').append(
        $('<button type="button" class="btn btn-primary btn-sm me-1 js-purpose-qr">').text('QR code'),
        $('<button type="button" class="btn btn-outline-secondary btn-sm js-toggle-purpose">').text(active ? 'Close' : 'Reopen')
      ));
      $body.append($row);
    });
  }

  $('#purposeTemplateForm').on('submit', function (event) {
    event.preventDefault();
    var form = this;
    $(form).find('input[type="text"], textarea').each(function () { this.value = $.trim(this.value); });
    if (!form.checkValidity()) {
      $(form).addClass('was-validated');
      $(form).find(':invalid').first().trigger('focus');
      return;
    }
    $('#createPurposeBtn').prop('disabled', true);
    $.ajax({
      url: '/api/admin/purpose-templates',
      method: 'POST',
      contentType: 'application/json',
      data: JSON.stringify({
        eventPlace: $('#purposeEventPlace').val(),
        eventDate: $('#purposeEventDate').val(),
        purpose: $('#templatePurpose').val(),
        signatoryId: $('#purposeSignatory').val()
      })
    })
      .done(function (res) {
        purposeTemplates.unshift(res.data);
        renderPurposeTemplates();
        form.reset();
        Cert.showToast('Purpose template created.', 'success');
        openQr(res.data);
      })
      .fail(function (jqXHR, textStatus) {
        var body = jqXHR.responseJSON || {};
        if (body.details && body.details.fields) Cert.applyFieldErrors($(form), body.details.fields);
        Cert.showToast(Cert.errorMessage(jqXHR, textStatus), 'danger');
      })
      .always(function () { $('#createPurposeBtn').prop('disabled', false); });
  });

  $('#purposeRows').on('click', '.js-purpose-qr', function () {
    var id = $(this).closest('tr').data('id');
    var item = purposeTemplates.filter(function (record) { return record.purposeId === id; })[0];
    if (item) openQr(item);
  });

  $('#purposeRows').on('click', '.js-toggle-purpose', function () {
    var $button = $(this);
    var id = $button.closest('tr').data('id');
    var item = purposeTemplates.filter(function (record) { return record.purposeId === id; })[0];
    if (!item) return;
    var next = item.status === 'Active' ? 'Closed' : 'Active';
    $button.prop('disabled', true);
    $.ajax({
      url: '/api/admin/purpose-templates/' + encodeURIComponent(id),
      method: 'PATCH',
      contentType: 'application/json',
      data: JSON.stringify({ status: next })
    })
      .done(function () { loadPurposeTemplates(); Cert.showToast(next === 'Active' ? 'Purpose template reopened.' : 'Purpose template closed.', 'success'); })
      .fail(function (jqXHR, textStatus) {
        $button.prop('disabled', false);
        Cert.showToast(Cert.errorMessage(jqXHR, textStatus), 'danger');
      });
  });

  /* ------------------------------ Row actions ------------------------------ */

  $('#eventRows').on('click', '.js-qr', function () {
    var ev = findEvent($(this).closest('tr').data('id'));
    if (ev) openQr(ev);
  });

  $('#eventRows').on('click', '.js-toggle', function () {
    var $btn = $(this).prop('disabled', true);
    var ev = findEvent($btn.closest('tr').data('id'));
    if (!ev) return;
    var next = ev.status === 'Active' ? 'Closed' : 'Active';

    $.ajax({
      url: '/api/admin/events/' + ev.eventId,
      method: 'PATCH',
      contentType: 'application/json',
      data: JSON.stringify({ status: next })
    })
      .done(function () {
        ev.status = next;
        renderEvents();
        Cert.showToast(next === 'Active' ? 'Event reopened.' : 'Event closed. No new certificates can be issued.', 'success');
      })
      .fail(function (jqXHR, textStatus) {
        Cert.showToast(Cert.errorMessage(jqXHR, textStatus), 'danger');
        $btn.prop('disabled', false);
      });
  });

  $('#eventRows').on('click', '.js-save-event-signatory', function () {
    var $button = $(this);
    var $row = $button.closest('tr');
    var ev = findEvent($row.data('id'));
    var signatoryId = $row.find('.js-event-signatory').val();
    if (!ev || !signatoryId) {
      Cert.showToast('Select an active signatory first.', 'warning');
      return;
    }
    $button.prop('disabled', true);
    $.ajax({
      url: '/api/admin/events/' + encodeURIComponent(ev.eventId),
      method: 'PATCH',
      contentType: 'application/json',
      data: JSON.stringify({ signatoryId: signatoryId })
    })
      .done(function (res) {
        ev.signatoryId = res.data.signatoryId;
        renderEvents();
        Cert.showToast('Event signatory saved.', 'success');
      })
      .fail(function (jqXHR, textStatus) { Cert.showToast(Cert.errorMessage(jqXHR, textStatus), 'danger'); })
      .always(function () { $button.prop('disabled', false); });
  });

  /* ------------------------------ Recipients ------------------------------ */

  var recipients = []; // certificates shown in the modal

  $('#eventRows').on('click', '.js-recipients', function () {
    var ev = findEvent($(this).closest('tr').data('id'));
    if (ev) openRecipients(ev);
  });

  var recipWithDetails = false; // true for the "no event" list (extra Details column)

  /** Loads a list of certificates into the modal. */
  function openCertList(title, url, withDetails) {
    recipients = [];
    recipWithDetails = withDetails;
    $('#recipTitle').text(title);
    $('#recipSummary').text('');
    $('#recipDetailsTh').toggleClass('d-none', !withDetails);
    $('#recipRows').empty();
    $('#recipEmpty').addClass('d-none');
    $('#recipLoading').removeClass('d-none');
    recipModal.show();

    $.getJSON(url)
      .done(function (res) {
        recipients = Array.isArray(res.data) ? res.data : res.data.certificates;
        renderRecipients();
      })
      .fail(function (jqXHR, textStatus) {
        $('#recipLoading').addClass('d-none');
        Cert.showToast(Cert.errorMessage(jqXHR, textStatus), 'danger');
      });
  }

  function openRecipients(ev) {
    openCertList(ev.eventName, '/api/admin/events/' + encodeURIComponent(ev.eventId) + '/certificates', false);
  }

  $('#allCertificatesBtn').on('click', function () {
    openCertList('Issued certificates', '/api/certificate/list', true);
  });

  function renderRecipients() {
    var $body = $('#recipRows').empty();
    var rejected = recipients.filter(function (c) { return c.status === 'Rejected'; }).length;

    $('#recipLoading').addClass('d-none');
    $('#recipEmpty').toggleClass('d-none', recipients.length > 0);
    $('#recipSummary').text(recipients.length
      ? recipients.length + ' issued' + (rejected ? ', ' + rejected + ' rejected' : '')
      : '');

    recipients.forEach(function (c) {
      var isRejected = c.status === 'Rejected';
      var $row = $('<tr>').attr('data-no', c.certificateNo);

      $row.append($('<td class="text-nowrap">').text(c.certificateNo));
      $row.append($('<td class="fw-semibold">').text(c.fullName));
      if (recipWithDetails) {
        $row.append($('<td>').text(
          [c.organization, c.venue, Cert.formatDate(c.eventDate)].filter(Boolean).join(' \u2022 ')
        ));
      }
      $row.append($('<td>').text(c.purpose || '\u2013'));
      $row.append($('<td class="text-nowrap">').text(Cert.formatDate(c.issueDate)));
      $row.append($('<td>').append(
        $('<span class="badge rounded-pill">')
          .addClass(isRejected ? 'text-bg-danger' : 'text-bg-success')
          .text(isRejected ? 'Rejected' : 'Valid')
      ));
      $row.append($('<td class="text-end text-nowrap">').append(
        $('<button type="button" class="btn btn-sm js-cert-status">')
          .addClass(isRejected ? 'btn-outline-primary' : 'btn-outline-danger')
          .text(isRejected ? 'Restore' : 'Reject')
      ));
      $body.append($row);
    });
  }

  $('#recipRows').on('click', '.js-cert-status', function () {
    var $btn = $(this);
    var no = $btn.closest('tr').data('no');
    var cert = recipients.filter(function (c) { return c.certificateNo === no; })[0];
    if (!cert) return;

    var reject = cert.status !== 'Rejected';
    var question = reject
      ? 'Reject certificate ' + no + ' (' + cert.fullName + ')?\n\nIt will no longer pass verification on the home page.'
      : 'Restore certificate ' + no + ' (' + cert.fullName + ')?\n\nIt will pass verification again.';
    if (!window.confirm(question)) return;

    $btn.prop('disabled', true);
    $.ajax({
      url: '/api/admin/certificates/' + encodeURIComponent(no),
      method: 'PATCH',
      contentType: 'application/json',
      data: JSON.stringify({ status: reject ? 'Rejected' : 'Valid' })
    })
      .done(function () {
        cert.status = reject ? 'Rejected' : 'Valid';
        renderRecipients();
        Cert.showToast(reject ? 'Certificate rejected.' : 'Certificate restored.', 'success');
      })
      .fail(function (jqXHR, textStatus) {
        $btn.prop('disabled', false);
        Cert.showToast(Cert.errorMessage(jqXHR, textStatus), 'danger');
      });
  });

  /* ------------------------------ QR modal ------------------------------ */

  function openQr(ev) {
    var base = ev.purposeId
      ? '/api/admin/purpose-templates/' + encodeURIComponent(ev.purposeId) + '/qr'
      : '/api/admin/events/' + encodeURIComponent(ev.eventId) + '/qr';
    $('#qrTitle').text(ev.eventName || ev.eventPlace || 'Certificate QR code');
    $('#qrImage').attr('src', base);
    $('#qrLink').val(ev.link);
    $('#qrDownload').attr({
      href: base + '?download=1',
      download: ev.purposeId ? 'purpose-' + ev.purposeId + '-qr.png' : 'event-' + ev.eventId + '-qr.png'
    });
    qrModal.show();
  }

  $('#copyLink').on('click', function () {
    var link = $('#qrLink').val();
    var done = function () { Cert.showToast('Link copied.', 'success'); };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(link).then(done, function () { $('#qrLink').trigger('select'); });
    } else {
      $('#qrLink').trigger('select');
      if (document.execCommand('copy')) done();
    }
  });

  // Print just the QR code and event title
  $('#qrPrint').on('click', function () {
    var w = window.open('', '_blank', 'width=600,height=720');
    if (!w) { Cert.showToast('Allow pop-ups to print the QR code.', 'warning'); return; }
    var doc = w.document;
    doc.title = 'Event QR code';
    var $style = doc.createElement('style');
    $style.textContent =
      'body{font-family:Georgia,serif;text-align:center;margin:40px;color:#14213d}' +
      'h1{font-size:28px;margin:0 0 8px}p{margin:4px 0;font-size:16px}img{width:420px;max-width:100%;margin:20px 0}';
    doc.head.appendChild($style);

    var h = doc.createElement('h1'); h.textContent = $('#qrTitle').text();
    var p = doc.createElement('p'); p.textContent = 'Scan to get your Certificate of Appearance';
    var img = doc.createElement('img'); img.src = $('#qrImage').attr('src');
    var l = doc.createElement('p'); l.textContent = $('#qrLink').val();
    doc.body.append(h, p, img, l);

    img.onload = function () { w.focus(); w.print(); };
  });
});
