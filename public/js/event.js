/** QR landing page: loads event settings and asks for its configured attendee fields. */
$(function () {
  'use strict';

  // URL looks like /e/ABCD2345
  var match = /^\/e\/([A-Za-z0-9]+)\/?$/.exec(window.location.pathname);
  var eventId = match ? match[1].toUpperCase() : '';

  var $form = $('#eventForm');
  var $submit = $('#submitBtn');

  function setLoading(isLoading) {
    $submit.prop('disabled', isLoading);
    $('#spinner').toggleClass('d-none', !isLoading);
    $('#submitText').text(isLoading ? 'Generating your certificate…' : 'Generate Certificate');
  }

  function showError(message) {
    $('#eventLoading').addClass('d-none');
    $('#eventError').text(message).removeClass('d-none');
  }

  /* ----------------------------- Load event ----------------------------- */

  if (!eventId) {
    showError('This event link is not valid.');
  } else {
    $.getJSON('/api/events/' + encodeURIComponent(eventId))
      .done(function (res) {
        var ev = res.data;
        $('#pageTitle').text(ev.certificateTitle || 'Certificate of Appearance');
        $('#evName').text(ev.eventName);
        $('#evDate').text(Cert.formatDate(ev.eventDate));
        $('#evVenue').text(ev.venue);
        if (ev.templateMode) {
          $('#eventDetails .event-standard-fact').addClass('d-none');
          $('#eventDetails').find('dt:not(.event-standard-fact), dd:not(.event-standard-fact)').remove();
          (ev.fixedFieldSummary || []).forEach(function (field) {
            $('#eventDetails').append(
              $('<dt>').text(field.label),
              $('<dd>').text(field.key === 'EVENT_DATE' ? Cert.formatDate(field.value) : field.value)
            );
          });
          $('#nameFieldContainer').addClass('d-none');
          $('#fullName').prop({ disabled: true, required: false });
          var $dynamicFields = $('#dynamicRecipientFields').empty();
          (ev.recipientFields || []).forEach(function (field) {
            var inputId = 'recipient-' + field.key;
            var $input = $('<input type="text" class="form-control">')
              .attr({ id: inputId, name: field.key, maxlength: field.key === 'NAME' ? 120 : 300 })
              .prop('required', field.required);
            if (field.key === 'NAME') $input.attr('autocomplete', 'name');
            var $group = $('<div class="mb-3">')
              .append($('<label class="form-label">').attr('for', inputId).text(field.label));
            $group.append($input, $('<div class="invalid-feedback">').text('Enter ' + field.label.toLowerCase() + '.'));
            if (field.key === 'NAME') {
              $group.append($('<div class="form-text">').text('This is printed on your certificate exactly as typed.'));
            }
            $dynamicFields.append($group);
          });
        }
        $('#eventLoading').addClass('d-none');
        $('#eventDetails').removeClass('d-none');
        document.title = ev.eventName + ' – Certificate';

        if (!ev.open) {
          $('#eventClosed').removeClass('d-none');
        } else if (!ev.signatoryReady) {
          $('#eventSignatoryMissing').removeClass('d-none');
        } else {
          $form.removeClass('d-none');
        }
      })
      .fail(function (jqXHR, textStatus) {
        showError(Cert.errorMessage(jqXHR, textStatus));
      });
  }

  $form.on('input change', '.is-invalid', function () { $(this).removeClass('is-invalid'); });

  /* ------------------------------- Submit ------------------------------- */

  $form.on('submit', function (event) {
    event.preventDefault();
    $('#result').addClass('d-none');
    $form.find('.is-invalid').removeClass('is-invalid');

    var $name = $('#fullName');
    $name.val($.trim($name.val()));
    if (!this.checkValidity()) {
      $form.addClass('was-validated');
      $form.find(':invalid').first().trigger('focus');
      Cert.showToast('Please correct the highlighted fields.', 'warning');
      return;
    }
    $form.removeClass('was-validated');

    setLoading(true);

    var payload;
    if ($('#dynamicRecipientFields').children().length) {
      var fields = {};
      $('#dynamicRecipientFields :input').each(function () {
        fields[this.name] = $.trim($(this).val());
      });
      payload = { fields: fields };
    } else {
      payload = { fullName: $name.val() };
    }

    Cert.postForPdf('/api/events/' + encodeURIComponent(eventId) + '/certificate', payload)
      .done(function (data, textStatus, jqXHR) {
        var blob = data instanceof Blob ? data : new Blob([data], { type: 'application/pdf' });
        var filename = Cert.getFilename(jqXHR, 'certificate-of-appearance.pdf');
        var url = Cert.downloadBlob(blob, filename);

        $('#resultNo').text(filename.replace(/\.pdf$/i, ''));
        $('#resultLink').attr({ href: url, download: filename });
        $('#result').removeClass('d-none');
        Cert.showToast('Certificate ' + filename.replace(/\.pdf$/i, '') + ' is ready.', 'success');
        $form[0].reset();
      })
      .fail(function (jqXHR, textStatus) {
        var body = jqXHR.responseJSON || {};
        if (body.details && body.details.fields) Cert.applyFieldErrors($form, body.details.fields);
        Cert.showToast(Cert.errorMessage(jqXHR, textStatus), 'danger');
        if (jqXHR.status === 403) {
          $form.addClass('d-none');
          $('#eventClosed').removeClass('d-none');
        }
      })
      .always(function () { setLoading(false); });
  });
});
