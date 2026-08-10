document.addEventListener('submit', function(e){
    e.preventDefault();
    document.getElementById('btn_submit').disabled = true;
    grecaptcha.ready(function() {
        grecaptcha.execute('6LfkAb0rAAAAAM-tEHZyFW8QkVd3Wpa0rzuv9SQd', {action: 'submit'}).then(function(token) {
            // Add your logic to submit to your backend server here.
            let form = e.target;

            let input = document.createElement('input');
                input.type = 'hidden';
                input.name = 'g-recaptcha-response';
                input.value = token;

                form.appendChild(input);

                form.submit();
        });
    });
});