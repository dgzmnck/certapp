/** Admin page: sign in, create events, show/download QR codes, open/close events. */
$(function () {
  'use strict';

  var qrModal = new bootstrap.Modal('#qrModal');
  var events = []; // last list loaded from the server
  var signatories = [];
  var purposeTemplates = [];
  var certificateTemplates = [];
  var certificates = [];
  var eventsLoaded = false;
  var accountOwner = false;

  /* ------------------------------ Views ------------------------------ */

  $.getJSON('/api/branding')
    .done(function (res) {
      var branding = res.data || {};
      $('#loginIssuerName').text(branding.issuerName || '');
      $('#loginIssuerAddress').text(branding.issuerAddress || '').toggleClass('d-none', !branding.issuerAddress);
    })
    .fail(function (jqXHR, textStatus) {
      console.error('Could not load issuer branding:', Cert.errorMessage(jqXHR, textStatus));
    });

  function showLogin() {
    $('#dashView').addClass('d-none');
    $('#loginView').removeClass('d-none');
    $('#username').trigger('focus');
  }

  function showDashboard(isOwner) {
    accountOwner = Boolean(isOwner);
    $('#accountsNavItem').toggleClass('d-none', !accountOwner);
    $('#loginView').addClass('d-none');
    $('#dashView').removeClass('d-none');
    loadSignatories();
    loadCertificateTemplates();
  }

  // Decide which view to show
  $.getJSON('/api/admin/me')
    .done(function (res) { return res.authenticated ? showDashboard(res.isOwner) : showLogin(); })
    .fail(showLogin);

  $('#adminNav').on('click', '.nav-link', function () {
    var panelId = $(this).data('panel');
    $('#adminNav .nav-link').removeClass('active');
    $(this).addClass('active');
    $('.admin-panel').prop('hidden', true);
    $('#' + panelId).prop('hidden', false);
    if (panelId === 'eventsPanel') loadEvents();
    if (panelId === 'createEventPanel') scheduleEventPreview();
    if (panelId === 'certificatesPanel') loadCertificates();
    if (panelId === 'accountsPanel' && accountOwner) loadAccounts();
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
      .done(function (res) {
        $('#password').val('');
        showDashboard(res.isOwner);
      })
      .fail(function (jqXHR, textStatus) {
        $('#loginError').text(Cert.errorMessage(jqXHR, textStatus)).removeClass('d-none');
      })
      .always(function () { $btn.prop('disabled', false); });
  });

  $('#logoutBtn').on('click', function () {
    $.ajax({ url: '/api/admin/logout', method: 'POST' }).always(function () {
      events = [];
      certificates = [];
      accountOwner = false;
      $('#accountsNavItem').addClass('d-none');
      $('#eventRows').empty();
      $('#recipRows').empty();
      showLogin();
    });
  });

  /* ------------------------------ Accounts ------------------------------ */

  function loadAccounts() {
    $('#accountLoading').removeClass('d-none');
    $.getJSON('/api/admin/accounts')
      .done(function (res) {
        var $rows = $('#accountRows').empty();
        var accounts = res.data || [];
        $('#accountLoading').addClass('d-none');
        $('#accountEmpty').toggleClass('d-none', accounts.length > 0);
        accounts.forEach(function (account) {
          $rows.append(
            $('<tr>').append(
              $('<td class="fw-semibold">').text(account.username),
              $('<td>').append(statusBadge(account.status)),
              $('<td>').text(account.createdAt ? new Date(account.createdAt).toLocaleString() : '')
            )
          );
        });
      })
      .fail(function (jqXHR, textStatus) {
        $('#accountLoading').addClass('d-none');
        if (jqXHR.status !== 401) Cert.showToast(Cert.errorMessage(jqXHR, textStatus), 'danger');
      });
  }

  $('#accountForm').on('submit', function (event) {
    event.preventDefault();
    var form = this;
    var password = $('#accountPassword').val();
    var confirmation = $('#accountPasswordConfirm').val();
    $('#accountPasswordConfirm').toggleClass('is-invalid', password !== confirmation);
    if (!form.checkValidity() || password !== confirmation) {
      $(form).addClass('was-validated');
      $(form).find(':invalid').first().trigger('focus');
      if (password !== confirmation) $('#accountPasswordConfirm').trigger('focus');
      return;
    }

    var $button = $('#createAccountBtn').prop('disabled', true);
    $.ajax({
      url: '/api/admin/accounts',
      method: 'POST',
      contentType: 'application/json',
      data: JSON.stringify({
        username: $.trim($('#accountUsername').val()),
        password: password
      })
    })
      .done(function () {
        form.reset();
        $(form).removeClass('was-validated');
        loadAccounts();
        Cert.showToast('Admin account created.', 'success');
      })
      .fail(function (jqXHR, textStatus) {
        var body = jqXHR.responseJSON || {};
        if (body.details && body.details.fields) Cert.applyFieldErrors($(form), body.details.fields);
        Cert.showToast(Cert.errorMessage(jqXHR, textStatus), 'danger');
      })
      .always(function () { $button.prop('disabled', false); });
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

      $row.append($('<td class="fw-semibold">').text(ev.eventName || ev.certificateTitle || 'Certificate event'));
      $row.append($('<td>').text(Cert.formatDate(ev.eventDate)));
      $row.append($('<td>').text(ev.venue));
      $row.append($('<td>').append(
        $('<button type="button" class="btn btn-link btn-sm p-0 js-event-recipients">')
          .attr('aria-expanded', ev.recipientsExpanded ? 'true' : 'false')
          .text(ev.recipientsExpanded ? 'Hide recipients' : (ev.certificateCount || 0) + ' issued')
      ));
      $row.append($('<td>').append(statusBadge(ev.status)));

      var $actions = $('<td class="text-end text-nowrap">');
      $actions.append(
        $('<button type="button" class="btn btn-outline-primary btn-sm me-1 js-event-preview">').text('Preview'),
        $('<button type="button" class="btn btn-primary btn-sm me-1 js-qr">').text('QR code'),
        $('<button type="button" class="btn btn-outline-primary btn-sm js-toggle">').text(open ? 'Close' : 'Reopen')
      );
      $row.append($actions);
      $body.append($row);

      if (ev.recipientsExpanded) {
        $body.append(renderEventRecipientsRow(ev));
      }
    });
  }

  function renderEventRecipientsRow(ev) {
    var $detailsCell = $('<td colspan="6">');
    var $details = $('<div class="p-2">');
    if (ev.recipientsLoading) {
      $details.append($('<span class="text-muted">').text('Loading issued certificates…'));
    } else if (ev.recipientsError) {
      $details.append($('<span class="text-danger">').text(ev.recipientsError));
    } else if (!ev.recipients || !ev.recipients.length) {
      $details.append($('<span class="text-muted">').text('No certificates have been issued for this event.'));
    } else {
      var $table = $('<table class="table table-sm mb-0">')
        .append($('<thead>').append($('<tr>').append(
          $('<th scope="col">').text('Recipient name'),
          $('<th scope="col">').text('Date issued')
        )));
      var $body = $('<tbody>');
      ev.recipients.forEach(function (certificate) {
        $body.append($('<tr>').append(
          $('<td>').text(certificate.fullName || ''),
          $('<td>').text(Cert.formatDate(certificate.issueDate))
        ));
      });
      $table.append($body);
      $details.append($table);
    }
    return $('<tr class="event-recipients-row">').append($detailsCell.append($details));
  }

  function loadEventRecipients(ev) {
    ev.recipientsExpanded = true;
    ev.recipientsLoading = true;
    ev.recipientsError = '';
    renderEvents();
    $.getJSON('/api/admin/events/' + encodeURIComponent(ev.eventId) + '/certificates')
      .done(function (res) {
        ev.recipients = res.data.certificates || [];
        ev.certificateCount = res.data.count;
        ev.recipientsLoading = false;
        renderEvents();
      })
      .fail(function (jqXHR, textStatus) {
        ev.recipientsLoading = false;
        ev.recipientsError = Cert.errorMessage(jqXHR, textStatus);
        renderEvents();
      });
  }

  function loadEvents() {
    eventsLoaded = false;
    $('#loadingMsg').removeClass('d-none');
    $.getJSON('/api/admin/events')
      .done(function (res) {
        events = res.data;
        eventsLoaded = true;
        renderEvents();
      })
      .fail(function (jqXHR, textStatus) {
        $('#loadingMsg').addClass('d-none');
        if (jqXHR.status !== 401) Cert.showToast(Cert.errorMessage(jqXHR, textStatus), 'danger');
      });
  }

  $('#newEventBtn').on('click', function () {
    $('#adminNav [data-panel="createEventPanel"]').trigger('click');
  });

  function findEvent(id) {
    return events.filter(function (e) { return e.eventId === id; })[0];
  }

  /* ------------------------ Reusable certificate templates ------------------------ */

  function addTemplateField(group, key, label, required, fixed) {
    var $row = $('<div class="row g-2 align-items-end template-field-row">');
    var $key = $('<input type="text" class="form-control" maxlength="40">')
      .attr('name', group + 'Key')
      .val(key || '');
    var $label = $('<input type="text" class="form-control" maxlength="80" required>')
      .attr('name', group + 'Label')
      .val(label || '');
    var $required = $('<input type="checkbox" class="form-check-input">')
      .attr('name', group + 'Required')
      .prop('checked', required !== false);
    if (fixed) {
      $key.prop('readonly', true);
      $required.prop('disabled', true).prop('checked', true);
    }
    if (group === 'recipient' && key === 'NAME') {
      $key.prop('disabled', true);
      $required.prop('disabled', true).prop('checked', true);
    }
    $row.append($('<div class="col-md-3">').append($('<label class="form-label">').text('Variable key'), $key));
    $row.append($('<div class="col-md-5">').append($('<label class="form-label">').text('Field label'), $label));
    $row.append($('<div class="col-md-2">').append(
      $('<div class="form-check mb-2">').append($required, $('<label class="form-check-label ms-1">').text('Required'))
    ));
    var $remove = $('<button type="button" class="btn btn-outline-danger btn-sm">').text('Remove');
    if (fixed || (group === 'recipient' && key === 'NAME')) $remove.prop('disabled', true);
    $row.append($('<div class="col-md-2 text-md-end">').append($remove));
    $remove.on('click', function () {
      $row.remove();
      refreshTemplateVariableSelect();
    });
    $('#' + group + 'TemplateFields').append($row);
  }

  function collectTemplateFields(group) {
    return $('#' + group + 'TemplateFields .template-field-row').map(function () {
      return {
        key: $.trim($(this).find('[name="' + group + 'Key"]').val()).toUpperCase(),
        label: $.trim($(this).find('[name="' + group + 'Label"]').val()),
        required: $(this).find('[name="' + group + 'Required"]').is(':checked')
      };
    }).get();
  }

  function clearTemplateFormErrors() {
    $('#templateFormErrors').addClass('d-none');
    $('#templateFormErrorList').empty();
    $('#certificateTemplateForm .server-invalid').removeClass('server-invalid');
    $('#certificateTemplateForm .template-field-error').remove();
    $('#certificateTemplateForm .is-invalid').removeClass('is-invalid');
  }

  function showTemplateFormErrors(fields) {
    clearTemplateFormErrors();
    var $form = $('#certificateTemplateForm');
    var $list = $('#templateFormErrorList');
    var firstInvalid = null;
    Object.keys(fields || {}).forEach(function (name) {
      var message = fields[name];
      $list.append($('<li>').text(message));
      var match = /^(adminFields|recipientFields)\.(\d+)$/.exec(name);
      if (match) {
        var $row = $('#' + match[1] + ' .template-field-row').eq(Number(match[2]));
        if ($row.length) {
          $row.addClass('server-invalid');
          $row.append($('<div class="col-12 template-field-error">').text(message));
          if (!firstInvalid) firstInvalid = $row.find('input').first();
        }
        return;
      }

      if (name === 'adminFields' || name === 'recipientFields') {
        var $container = $('#' + (name === 'adminFields' ? 'adminTemplateFields' : 'recipientTemplateFields'));
        $container.after($('<div class="template-field-error">').text(message));
        if (!firstInvalid) firstInvalid = $container.find('input').first();
        return;
      }

      var $input = $form.find('[name="' + name + '"]');
      if ($input.length) {
        $input.addClass('is-invalid');
        $input.siblings('.invalid-feedback').text(message);
        if (!firstInvalid) firstInvalid = $input;
      }
    });
    $('#templateFormErrors').removeClass('d-none');
    if (firstInvalid && firstInvalid.length) {
      firstInvalid.trigger('focus');
      firstInvalid[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      $('#templateFormErrors')[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  function refreshTemplateVariableSelect() {
    var $select = $('#templateVariableSelect').empty().append(
      $('<option>').val('').text('Select a variable')
    );
    var variables = collectTemplateFields('admin').concat(collectTemplateFields('recipient'))
      .map(function (field) { return field.key; });
    Array.from(new Set(variables.filter(Boolean))).forEach(function (key) {
      $select.append($('<option>').val(key).text('_' + key + '_'));
    });
  }

  function renderInstanceFields(template) {
    var $fields = $('#instanceFixedFields').empty();
    if (!template) return;
    template.adminFields.forEach(function (field) {
      var $input = $('<input class="form-control">')
        .attr({ name: field.key, maxlength: field.key === 'NAME' ? 120 : 300 })
        .prop('required', field.required);
      if (field.key === 'EVENT_DATE') $input.attr('type', 'date');
      else $input.attr('type', 'text');
      var $group = $('<div class="col-sm-6 col-lg-3">')
        .append($('<label class="form-label">').attr('for', 'instance-' + field.key).text(field.label));
      $input.attr('id', 'instance-' + field.key);
      $group.append($input, $('<div class="invalid-feedback">').text('Enter ' + field.label.toLowerCase() + '.'));
      $fields.append($group);
    });
  }

  function renderCertificateTemplates() {
    var $body = $('#certificateTemplateRows').empty();
    $('#certificateTemplateLoading').addClass('d-none');
    $('#certificateTemplateEmpty').toggleClass('d-none', certificateTemplates.length > 0);
    var $select = $('#instanceTemplate').empty().append(
      $('<option>').val('').text('Select a saved template')
    );
    certificateTemplates.filter(function (template) {
      return template.status === 'Active';
    }).forEach(function (template) {
      $select.append($('<option>').val(template.templateId).text(template.templateName));
      var $row = $('<tr>').attr('data-id', template.templateId);
      $row.append($('<td class="fw-semibold">').text(template.templateName));
      $row.append($('<td>').text(template.certificateTitle));
      $row.append($('<td>').text(
        template.adminFields.length + ' organizer, ' + template.recipientFields.length + ' attendee'
      ));
      $row.append($('<td class="text-end">').append(
        $('<button type="button" class="btn btn-primary btn-sm js-create-template-instance">').text('Create event instance')
      ));
      $body.append($row);
    });
  }

  function loadCertificateTemplates() {
    $('#certificateTemplateLoading').removeClass('d-none');
    $.getJSON('/api/admin/certificate-templates')
      .done(function (res) {
        certificateTemplates = res.data;
        renderCertificateTemplates();
      })
      .fail(function (jqXHR, textStatus) {
        $('#certificateTemplateLoading').addClass('d-none');
        if (jqXHR.status !== 401) Cert.showToast(Cert.errorMessage(jqXHR, textStatus), 'danger');
      });
  }

  addTemplateField('admin', 'EVENT_NAME', 'Event name', true, true);
  addTemplateField('admin', 'EVENT_DATE', 'Event date', true, true);
  addTemplateField('admin', 'EVENT_PLACE', 'Event place', true, true);
  addTemplateField('admin', 'ISSUE_PLACE', 'Issue place', true);
  addTemplateField('recipient', 'NAME', 'Full name', true);
  refreshTemplateVariableSelect();

  $('#addAdminTemplateField').on('click', function () {
    addTemplateField('admin', '', '', true);
    refreshTemplateVariableSelect();
  });
  $('#addRecipientTemplateField').on('click', function () {
    addTemplateField('recipient', '', '', true);
    refreshTemplateVariableSelect();
  });
  $('#insertTemplateVariable').on('click', function () {
    var key = $('#templateVariableSelect').val();
    if (!key) return;
    var textarea = $('#templateMessage')[0];
    var token = '_' + key + '_';
    var start = textarea.selectionStart;
    var end = textarea.selectionEnd;
    textarea.value = textarea.value.slice(0, start) + token + textarea.value.slice(end);
    textarea.focus();
    textarea.setSelectionRange(start + token.length, start + token.length);
  });

  var previewTimer;
  function refreshEventCertificatePreview() {
    var templateId = $('#instanceTemplate').val();
    var signatoryId = $('#instanceSignatory').val();
    if (!templateId) {
      $('#eventPreviewError').text('Select a certificate template to preview the event.').removeClass('d-none');
      $('#eventPreviewFrame').removeAttr('srcdoc');
      return;
    }
    if (!signatoryId) {
      $('#eventPreviewError').text('Select an active signatory to preview the certificate.').removeClass('d-none');
      $('#eventPreviewFrame').removeAttr('srcdoc');
      return;
    }

    var fixedValues = {};
    $('#instanceFixedFields :input').each(function () {
      fixedValues[this.name] = $.trim($(this).val());
    });
    $('#eventPreviewError').addClass('d-none').text('');
    $.ajax({
      url: '/api/admin/certificate-preview',
      method: 'POST',
      contentType: 'application/json',
      dataType: 'text',
      data: JSON.stringify({
        templateId: templateId,
        fixedValues: fixedValues,
        signatoryId: signatoryId
      })
    })
      .done(function (html) { $('#eventPreviewFrame')[0].srcdoc = html; })
      .fail(function (jqXHR, textStatus) {
        $('#eventPreviewError').text(Cert.errorMessage(jqXHR, textStatus)).removeClass('d-none');
      });
  }

  function refreshSavedEventPreview(eventId) {
    $('#eventSavedPreview').removeClass('d-none');
    $('#eventSavedPreviewTitle').text('Certificate preview — ' + (findEvent(eventId).eventName || 'Event'));
    $('#savedEventPreviewError').addClass('d-none').text('');
    $.ajax({
      url: '/api/admin/certificate-preview',
      method: 'POST',
      contentType: 'application/json',
      dataType: 'text',
      data: JSON.stringify({ eventId: eventId })
    })
      .done(function (html) { $('#savedEventPreviewFrame')[0].srcdoc = html; })
      .fail(function (jqXHR, textStatus) {
        $('#savedEventPreviewError').text(Cert.errorMessage(jqXHR, textStatus)).removeClass('d-none');
      });
  }

  function scheduleEventPreview() {
    if (!$('#createEventPanel').prop('hidden')) {
      window.clearTimeout(previewTimer);
      previewTimer = window.setTimeout(refreshEventCertificatePreview, 300);
    }
  }

  function setPreviewZoom(frameId, zoom) {
    var frame = document.getElementById(frameId);
    if (!frame) return;
    var normalizedZoom = Math.max(0.5, Math.min(2, Math.round(zoom * 10) / 10));
    frame.style.zoom = normalizedZoom;
    $('[data-preview-zoom-label="' + frameId + '"]').text(Math.round(normalizedZoom * 100) + '%');
  }

  $('.js-preview-zoom').on('click', function () {
    var frameId = $(this).data('target');
    var currentZoom = parseFloat(document.getElementById(frameId).style.zoom) || 1;
    setPreviewZoom(frameId, currentZoom + Number($(this).data('step')));
  });

  $('.js-preview-zoom-reset').on('click', function () {
    setPreviewZoom($(this).data('target'), 1);
  });

  $('#instanceTemplate, #instanceSignatory').on('change', scheduleEventPreview);
  $('#instanceFixedFields').on('input change', ':input', scheduleEventPreview);
  $('#adminTemplateFields, #recipientTemplateFields').on('input change', 'input', function () {
    clearTemplateFormErrors();
    refreshTemplateVariableSelect();
  });

  $('#certificateTemplateForm').on('submit', function (event) {
    event.preventDefault();
    var form = this;
    clearTemplateFormErrors();
    if (!form.checkValidity()) {
      $(form).addClass('was-validated');
      var $invalid = $(form).find(':invalid').first();
      $invalid.trigger('focus');
      $invalid[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    var $button = $('#saveCertificateTemplateBtn').prop('disabled', true);
    $.ajax({
      url: '/api/admin/certificate-templates',
      method: 'POST',
      contentType: 'application/json',
      data: JSON.stringify({
        templateName: $.trim($('#templateName').val()),
        certificateTitle: $.trim($('#templateCertificateTitle').val()),
        messageTemplate: $('#templateMessage').val(),
        adminFields: collectTemplateFields('admin'),
        recipientFields: collectTemplateFields('recipient')
      })
    })
      .done(function (res) {
        certificateTemplates.unshift(res.data);
        renderCertificateTemplates();
        Cert.showToast('Certificate template saved.', 'success');
      })
      .fail(function (jqXHR, textStatus) {
        var body = jqXHR.responseJSON || {};
        if (body.details && body.details.fields) showTemplateFormErrors(body.details.fields);
        else {
          $('#templateFormErrors').removeClass('d-none');
          $('#templateFormErrorList').empty().append($('<li>').text(Cert.errorMessage(jqXHR, textStatus)));
          $('#templateFormErrors')[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        Cert.showToast(Cert.errorMessage(jqXHR, textStatus), 'danger');
      })
      .always(function () { $button.prop('disabled', false); });
  });

  $('#instanceTemplate').on('change', function () {
    var selected = certificateTemplates.filter(function (template) {
      return template.templateId === $('#instanceTemplate').val();
    })[0];
    renderInstanceFields(selected);
    scheduleEventPreview();
  });

  $('#certificateTemplateRows').on('click', '.js-create-template-instance', function () {
    var id = $(this).closest('tr').data('id');
    $('#adminNav [data-panel="createEventPanel"]').trigger('click');
    $('#instanceTemplate').val(id).trigger('change');
    $('#instanceTemplate').trigger('focus');
  });

  $('#templateInstanceForm').on('submit', function (event) {
    event.preventDefault();
    var form = this;
    $(form).find('.is-invalid').removeClass('is-invalid');
    if (!form.checkValidity()) {
      $(form).addClass('was-validated');
      $(form).find(':invalid').first().trigger('focus');
      return;
    }
    var $button = $('#createInstanceBtn').prop('disabled', true);
    var fixedValues = {};
    $('#instanceFixedFields :input').each(function () {
      fixedValues[this.name] = $.trim($(this).val());
    });
    $.ajax({
      url: '/api/admin/events',
      method: 'POST',
      contentType: 'application/json',
      data: JSON.stringify({
        templateId: $('#instanceTemplate').val(),
        fixedValues: fixedValues,
        signatoryId: $('#instanceSignatory').val()
      })
    })
      .done(function (res) {
      loadEvents();
      form.reset();
      renderInstanceFields(null);
      $('#eventPreviewFrame').removeAttr('srcdoc');
      $('#eventPreviewError').addClass('d-none').text('');
      Cert.showToast('Event instance created.', 'success');
      openQr(res.data);
    })
      .fail(function (jqXHR, textStatus) {
        var body = jqXHR.responseJSON || {};
        if (body.details && body.details.fields) Cert.applyFieldErrors($(form), body.details.fields);
        Cert.showToast(Cert.errorMessage(jqXHR, textStatus), 'danger');
      })
      .always(function () { $button.prop('disabled', false); });
  });

  /* ------------------------------ Signatories ------------------------------ */

  function populateSignatorySelects() {
    ['#purposeSignatory', '#instanceSignatory'].forEach(function (selector) {
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
        renderSignatories();
      })
      .fail(function (jqXHR, textStatus) {
        $('#signatoryLoading').addClass('d-none');
        if (jqXHR.status !== 401) Cert.showToast(Cert.errorMessage(jqXHR, textStatus), 'danger');
      });
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

  $('#eventRows').on('click', '.js-event-recipients', function () {
    var ev = findEvent($(this).closest('tr').data('id'));
    if (!ev) return;
    if (ev.recipientsExpanded) {
      ev.recipientsExpanded = false;
      renderEvents();
    } else if (ev.recipients) {
      ev.recipientsExpanded = true;
      renderEvents();
    } else {
      loadEventRecipients(ev);
    }
  });

  $('#eventRows').on('click', '.js-event-preview', function () {
    var ev = findEvent($(this).closest('tr').data('id'));
    if (ev) refreshSavedEventPreview(ev.eventId);
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

  /* ------------------------------ Certificates ------------------------------ */

  function loadCertificates() {
    $('#recipRows').empty();
    $('#recipEmpty').addClass('d-none');
    $('#recipLoading').removeClass('d-none');
    $.getJSON('/api/certificate/list?limit=500&offset=0')
      .done(function (res) {
        certificates = res.data || [];
        var total = Number(res.total) || certificates.length;
        function loadNextPage(offset) {
          if (offset >= total) {
            renderCertificates();
            return;
          }
          $.getJSON('/api/certificate/list?limit=500&offset=' + offset)
            .done(function (page) {
              var items = page.data || [];
              if (!items.length) {
                $('#recipLoading').addClass('d-none');
                Cert.showToast('Could not load all certificate records. Please try again.', 'danger');
                return;
              }
              certificates = certificates.concat(items);
              loadNextPage(offset + items.length);
            })
            .fail(function (jqXHR, textStatus) {
              $('#recipLoading').addClass('d-none');
              Cert.showToast(Cert.errorMessage(jqXHR, textStatus), 'danger');
            });
        }
        loadNextPage(certificates.length);
      })
      .fail(function (jqXHR, textStatus) {
        $('#recipLoading').addClass('d-none');
        Cert.showToast(Cert.errorMessage(jqXHR, textStatus), 'danger');
      });
  }

  function certificateDetails(certificate) {
    var values = certificate.fieldValues || {};
    var labels = certificate.fieldLabels || {};
    var details = [];
    var shown = {};

    function add(key, label, value) {
      if (value === undefined || value === null || value === '') return;
      var normalized = key.toUpperCase();
      if (shown[normalized]) return;
      shown[normalized] = true;
      if (normalized === 'EVENT_DATE' || normalized === 'DATE') value = Cert.formatDate(value);
      details.push({ label: label, value: value });
    }

    Object.keys(values).forEach(function (key) {
      if (key.toUpperCase() === 'NAME') return;
      var label = labels[key] || key.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, function (letter) {
        return letter.toUpperCase();
      });
      add(key, label, values[key]);
    });
    add('ORGANIZATION', 'Organization', certificate.organization);
    add('EVENT_NAME', 'Event', certificate.eventName);
    add('EVENT_PLACE', 'Event place', certificate.venue);
    add('EVENT_DATE', 'Event date', certificate.eventDate);
    add('PURPOSE', 'Purpose', certificate.purpose);
    return details;
  }

  function certificateEventName(certificate) {
    var values = certificate.fieldValues || {};
    return values.EVENT_NAME || certificate.eventName || '';
  }

  function updateCertificateEventFilter() {
    var $filter = $('#certificateEventFilter');
    var selected = $filter.val();
    var eventNames = Array.from(new Set(certificates.map(certificateEventName).filter(Boolean)))
      .sort(function (a, b) { return a.localeCompare(b); });
    $filter.empty().append($('<option>').val('').text('All events / certificates'));
    if (certificates.some(function (certificate) { return !certificateEventName(certificate); })) {
      $filter.append($('<option>').val('__no_event__').text('No event name'));
    }
    eventNames.forEach(function (name) {
      $filter.append($('<option>').val(name).text(name));
    });
    if ($filter.find('option').filter(function () { return this.value === selected; }).length) {
      $filter.val(selected);
    }
  }

  function matchesCertificateFilter(certificate, query, eventFilter) {
    var eventName = certificateEventName(certificate);
    if (eventFilter === '__no_event__' && eventName) return false;
    if (eventFilter && eventFilter !== '__no_event__' && eventName !== eventFilter) return false;
    if (!query) return true;

    var searchable = [
      certificate.fullName,
      certificate.certificateNo,
      certificate.certificateTitle,
      certificate.type,
      eventName
    ].concat(certificateDetails(certificate).map(function (detail) {
      return detail.label + ' ' + detail.value;
    }));
    return searchable.join(' ').toLowerCase().indexOf(query) !== -1;
  }

  function renderCertificates() {
    var $body = $('#recipRows').empty();
    updateCertificateEventFilter();
    var query = $.trim($('#certificateSearch').val() || '').toLowerCase();
    var eventFilter = $('#certificateEventFilter').val() || '';
    var filteredCertificates = certificates.filter(function (certificate) {
      return matchesCertificateFilter(certificate, query, eventFilter);
    });
    var rejected = certificates.filter(function (item) { return item.status === 'Rejected'; }).length;
    $('#recipLoading').addClass('d-none');
    $('#recipEmpty')
      .text(certificates.length ? 'No certificates match these filters.' : 'No certificates have been issued yet.')
      .toggleClass('d-none', filteredCertificates.length > 0);
    $('#recipSummary').text(certificates.length
      ? filteredCertificates.length + ' of ' + certificates.length + ' issued' + (rejected ? ', ' + rejected + ' rejected' : '')
      : '');

    filteredCertificates.forEach(function (certificate) {
      var isRejected = certificate.status === 'Rejected';
      var $row = $('<tr>').attr('data-no', certificate.certificateNo);
      $row.append($('<td class="text-nowrap">').text(certificate.certificateNo));
      $row.append($('<td class="fw-semibold">').text(certificate.fullName));

      var $details = $('<td>').append(
        $('<div class="fw-semibold mb-1">').text(certificate.certificateTitle || certificate.type || 'Certificate')
      );
      certificateDetails(certificate).forEach(function (detail) {
        $details.append($('<div>').append(
          $('<span class="text-muted">').text(detail.label + ': '),
          document.createTextNode(detail.value)
        ));
      });
      $row.append($details);
      $row.append($('<td class="text-nowrap">').text(Cert.formatDate(certificate.issueDate)));
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

  $('#certificateSearch').on('input', renderCertificates);
  $('#certificateEventFilter').on('change', renderCertificates);

  $('#recipRows').on('click', '.js-cert-status', function () {
    var $button = $(this);
    var certificateNo = $button.closest('tr').data('no');
    var certificate = certificates.filter(function (item) {
      return item.certificateNo === certificateNo;
    })[0];
    if (!certificate) return;

    var reject = certificate.status !== 'Rejected';
    var question = reject
      ? 'Reject certificate ' + certificateNo + ' (' + certificate.fullName + ')?\n\nIt will no longer pass verification.'
      : 'Restore certificate ' + certificateNo + ' (' + certificate.fullName + ')?';
    if (!window.confirm(question)) return;

    $button.prop('disabled', true);
    $.ajax({
      url: '/api/admin/certificates/' + encodeURIComponent(certificateNo),
      method: 'PATCH',
      contentType: 'application/json',
      data: JSON.stringify({ status: reject ? 'Rejected' : 'Valid' })
    })
      .done(function () {
        certificate.status = reject ? 'Rejected' : 'Valid';
        renderCertificates();
        Cert.showToast(reject ? 'Certificate rejected.' : 'Certificate restored.', 'success');
      })
      .fail(function (jqXHR, textStatus) {
        $button.prop('disabled', false);
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
