$('#marca').change(function(){
    $('#marca option:selected').each(function(){
        var id_marca = $('.marca').val();
        if(id_marca != ""){
            //$('#agencia').append('<option value="">Selecciona una agencia...</option>');
            //var _token = $('input[name = "_token"]').val();
            
            $.get('search-agencias' + '/' + id_marca,
            function(data){
                    var datos_registros = JSON.parse(data);
                    var registros = '';
                    //var datos = JSON.parse(data);
                    $.each(datos_registros,function(i,item){
                        //alert(item.nombre_marca_zapata+' '+item.nombre_agencia_zapata)
                        $('#agencia').html('<option value="">Selecciona una agencia...</option>');
                        registros+='<option value="'+item.idagencia_zapata+'">'+item.nombre_marca_zapata+' '+item.nombre_agencia_zapata+'</option>';
                    });
                    $('#agencia').append(registros);
            });
        }else{
            $('#agencia').html('<option value="">Selecciona una agencia...</option>');
        }
    });
});

$('#agencia').change(function(){
    var id_agencia = $('#agencia').val();
    if(id_agencia != ""){
        $('.datos-agencias').html(
            '<div class="caja-titulo"></div>'+
            '<div class="row">'+
                '<div class="col-xs-12 col-sm-12 col-md-5 col-lg-5">'+
                    '<ul class="fa-ul">'+
                        '<li>'+
                            '<div class="div-direccion"><i class="fa-li fa fa-map-marker"></i>'+
                            '</div>'+
                            '<p class="direccion"></p>'+
                        '</li>'+
                        '<li>'+
                            '<div class="div-telefono"><i class="fa-li fa fa-phone"></i>'+
                            '</div>'+
                            '<p class="telefono"></p>'+
                        '</li>'+
                        '<li>'+
                            '<div class="div-sitio-web"><i class="fa-li fa fa-globe"></i>'+
                            '</div>'+
                            '<p class="sitio-web"></p>'+
                        '</li>'+
                        '<li>'+
                            '<div class="visible-xs visible-sm" style="padding-top:4%;"></div>'+
                            '<div class="div-boton">'+
                            '</div>'+
                        '</li>'+
                    '</ul>'+
                    '<div class="visible-xs visible-sm" style="padding-top:7%;"></div>'+
                '</div>'+
                '<div class="col-xs-12 col-sm-12 col-md-7 col-lg-7">'+
                    '<div class="table-responsive">'+
                        '<div class="div-contactos-agencia">'+
                        '</div>'+
                        '<table class="table table-striped">'+
                            '<thead>'+
                                '<tr>'+
                                    '<th class="contactos-agencia" scope="col"><i class="fa fa-user"></i> Contacto</th>'+
                                    '<th class="contactos-agencia" scope="col"><i class="fa fa-briefcase"></i> Cargo</th>'+
                                    '<th class="contactos-agencia" scope="col"><i class="fa fa-phone"></i> Teléfono</th>'+
                                    '<th class="contactos-agencia" scope="col">Ext: </th>'+
                                    '<th class="contactos-agencia" scope="col"><i class="fa fa-envelope-square"></i> Correo</th>'+
                                '</tr>'+
                            '</thead>'+
                            '<tbody class="contactos-agencia-tabla">'+
                            '</tbody>'+
                        '</table>'+
                    '</div>'+
                '</div>'+
            '</div>');
        $('.mapa-agencia').html('');
        var _token = $('input[name = "_token"]').val();
        
        $.get('search-datos' + '/' + id_agencia,
        //{_token: _token,id_agencia: id_agencia},
        function(data){
            var datos = JSON.parse(data);
            // alert(datos);
            $.each(datos,function(i,item){
                
                var nombre_marca_zapata = item.nombre_marca_zapata;
                var nombre_agencia_zapata = item.nombre_agencia_zapata;
                var direccion_agencia = item.direccion_agencia;
                var telefono_agencia = item.telefono_agencia;
                var sitio_web = item.sitio_web;
                var ruta_google_maps = item.ruta_google_maps;
                var nombre_contacto = item.nombre_contacto;
                var apellido_paterno = item.apellido_paterno;
                
                if(item.ext == null || item.ext == 0){
                    var ext = '';
                }else{
                    var ext = item.ext;   
                }
                if(direccion_agencia == null){
                    $('.div-direccion').html('');
                }else{
                    $('.direccion').html(item.direccion_agencia);
                }
                if(telefono_agencia == null){
                    $('.div-telefono').html('');
                }else{
                    $('.telefono').html(item.telefono_agencia);
                }
                if(sitio_web == null){
                    $('.div-sitio-web').html('');
                }else{
                    $('.sitio-web').html('<a href="'+item.sitio_web+'" target="_blank">'+item.sitio_web+'</a>');
                }
                if(nombre_contacto == null && apellido_paterno == null){
                    $('.div-contactos-agencia').html('');
                    $('.table-responsive').html('');
                }else{
                    $('.contactos-agencia-tabla').append(
                        '<tr>'+
                            '<td class="contactos">'+item.nombre_contacto+' '+item.apellido_paterno+' '+item.apellido_materno+'</td>'+
                            '<td class="contactos">'+item.puesto+'</td>'+
                            '<td class="contactos">'+(item.telefono ?? '')+'</td>'+
                            '<td class="contactos">'+ext+'</td>'+
                            '<td class="contactos">'+item.email+'</td>'+
                        '</tr>'
                    );
                }
                $('.caja-titulo').html(
                    '<div class="titulo">'+
                        '<p class="texto-titulo">'+
                            item.nombre_marca_zapata+' '+item.nombre_agencia_zapata+
                        '</p>'+
                    '</div>'
                );
                    
                $('.div-boton').html('<a href="'+item.ruta_agencia+'" target="_blank" class="btn llegar btn-agencia">Abrir en Google Maps <i class="fa fa-share-square"></i></a>');
                $('.mapa-agencia').html('<iframe src="'+item.ruta_google_maps+'" height="400" frameborder="0" style="border:0;" allowfullscreen=""></iframe>');
            });
        });
    }else{
        $('.titulo').html('');
        $('.fa-ul').html('');
        $('.mapa-agencia').html('');
    }
});

