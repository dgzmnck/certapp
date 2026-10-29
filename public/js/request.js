/** "CA without event" page: the requester supplies every detail, including the purpose. */
$(function () {
  'use strict';

  var $form = $('#requestForm');
  var $submit = $('#submitBtn');

  function setLoading(isLoading) {
    $submit.prop('disabled', isLoading);
    $('#spinner').toggleClass('d-none', !isLoading);
    $('#submitText').text(isLoading ? 'Generating your certificate\u2026' : 'Generate Certificate');
  }

  $('#purpose').on('input', function () { $('#purposeCount').text(this.value.length); });
  $form.on('input change', '.is-invalid', function () { $(this).removeClass('is-invalid'); });

  $form.on('submit', function (event) {
    event.preventDefault();
    $('#result').addClass('d-none');
    $form.find('.is-invalid').removeClass('is-invalid');
    $form.find('input[type="text"], textarea').each(function () { this.value = $.trim(this.value); });

    if (!this.checkValidity()) {
      $form.addClass('was-validated');
      $form.find(':invalid').first().trigger('focus');
      Cert.showToast('Please complete the highlighted fields.', 'warning');
      return;
    }
    $form.removeClass('was-validated');

    setLoading(true);

    Cert.postForPdf('/api/certificate/request', {
      fullName: $('#fullName').val(),
      organization: $('#organization').val(),
      venue: $('#venue').val(),
      eventDate: $('#eventDate').val(),
      purpose: $('#purpose').val()
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
        $('#purposeCount').text('0');
      })
      .fail(function (jqXHR, textStatus) {
        var body = jqXHR.responseJSON || {};
        if (body.details && body.details.fields) Cert.applyFieldErrors($form, body.details.fields);
        Cert.showToast(Cert.errorMessage(jqXHR, textStatus), 'danger');
      })
      .always(function () { setLoading(false); });
  });
});
