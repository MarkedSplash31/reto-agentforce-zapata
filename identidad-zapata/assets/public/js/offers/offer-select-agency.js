// $( window ).on( "load", function() {
//     var url_promo = location.href;
//     document.getElementById('url_promo').value = url_promo;
// });

// Para obtener los datos de las localidades en caso de 2 o mas por promocion
let ownerId = document.getElementById('00NNv000000RHG5');
let centro  = document.getElementById('00NNv000000NWOz');
let locationSelect = document.getElementById('localidad');

locationSelect.addEventListener('change', function (e) {

    let url_getData =  urlSelect + '/' + this.value

    fetch(url_getData)
        .then(response => response.json())
        .then(data => {
            ownerId.value = data.ownerId
            centro.value = data.centro;
        })
        .catch(error => {
            console.log('Error:' , error);
        })

});