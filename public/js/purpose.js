/** Public purpose-template flow: the template controls the certificate details. */
$(function () {
  'use strict';

  var match = /^\/p\/([A-Za-z0-9-]+)\/?$/.exec(window.location.pathname);
  var purposeId = match ? match[1].toUpperCase() : '';
  var $form = $('#purposeForm');
  var $submit = $('#submitBtn');

  function showError(message) {
    $('#purposeLoading').addClass('d-none');
    $('#purposeError').text(message).removeClass('d-none');
  }

  if (!purposeId) {
    showError('This certificate link is not valid.');
  } else {
    $.getJSON('/api/purpose-templates/' + encodeURIComponent(purposeId))
      .done(function (res) {
        var template = res.data;
        $('#purposePlace').text(template.eventPlace);
        $('#purposeDate').text(Cert.formatDate(template.eventDate));
        $('#purposeText').text(template.purpose);
        $('#purposeLoading').addClass('d-none');
        $('#purposeDetails').removeClass('d-none');
        document.title = 'Certificate – ' + template.eventPlace;
        if (template.open) $form.removeClass('d-none');
        else $('#purposeClosed').removeClass('d-none');
      })
      .fail(function (jqXHR, textStatus) { showError(Cert.errorMessage(jqXHR, textStatus)); });
  }

  $form.on('input change', '.is-invalid', function () { $(this).removeClass('is-invalid'); });
  $form.on('submit', function (event) {
    event.preventDefault();
    $('#result').addClass('d-none');
    $form.find('.is-invalid').removeClass('is-invalid');
    $('#fullName, #organization').each(function () { this.value = $.trim(this.value); });
    if (!this.checkValidity()) {
      $form.addClass('was-validated');
      $form.find(':invalid').first().trigger('focus');
      Cert.showToast('Please complete the highlighted fields.', 'warning');
      return;
    }

    $submit.prop('disabled', true);
    $('#spinner').removeClass('d-none');
    $('#submitText').text('Generating your certificate…');
    Cert.postForPdf('/api/purpose-templates/' + encodeURIComponent(purposeId) + '/certificate', {
      fullName: $('#fullName').val(),
      organization: $('#organization').val()
    })
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
      })
      .always(function () {
        $submit.prop('disabled', false);
        $('#spinner').addClass('d-none');
        $('#submitText').text('Generate Certificate');
      });
  });
});
