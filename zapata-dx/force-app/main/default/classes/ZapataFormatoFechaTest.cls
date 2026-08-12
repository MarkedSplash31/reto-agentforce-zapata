@IsTest
private class ZapataFormatoFechaTest {

    /** Se fija la zona a Mexico porque el texto que lee el operador depende de ella. */
    private static User usuarioMexico() {
        // Por Name no: los perfiles de esta org estan en espanol. UserType es estable.
        Profile p = [SELECT Id FROM Profile WHERE UserType = 'Standard' LIMIT 1];
        return new User(
            FirstName = 'Zapata',
            LastName = 'Formato',
            Alias = 'zfmt',
            Email = 'zapata.formato@example.com',
            Username = 'zapata.formato.' + System.now().getTime() + '@example.com',
            ProfileId = p.Id,
            TimeZoneSidKey = 'America/Mexico_City',
            LocaleSidKey = 'es_MX',
            EmailEncodingKey = 'UTF-8',
            LanguageLocaleKey = 'en_US'
        );
    }

    @IsTest
    static void devuelveRangoConDiaYMesEnEspanol() {
        // 11 de agosto de 2026 fue martes.
        ZapataFormatoFecha.Peticion p = new ZapataFormatoFecha.Peticion();
        p.inicio = Datetime.newInstanceGmt(2026, 8, 11, 15, 0, 0);
        p.fin = Datetime.newInstanceGmt(2026, 8, 11, 17, 0, 0);

        List<ZapataFormatoFecha.Respuesta> r;
        System.runAs(usuarioMexico()) {
            r = ZapataFormatoFecha.formatear(new List<ZapataFormatoFecha.Peticion>{ p });
        }

        Assert.areEqual(1, r.size(), 'Una peticion, una respuesta');
        Assert.isTrue(r[0].texto.startsWith('martes 11 de agosto'),
            'Esperaba el dia y mes en espanol, llego: ' + r[0].texto);
        Assert.isTrue(r[0].texto.contains(' a '), 'Con fin debe ser un rango: ' + r[0].texto);
    }

    @IsTest
    static void sinFinDevuelveSoloLaHoraDeInicio() {
        ZapataFormatoFecha.Peticion p = new ZapataFormatoFecha.Peticion();
        p.inicio = Datetime.newInstanceGmt(2026, 8, 11, 15, 0, 0);

        List<ZapataFormatoFecha.Respuesta> r;
        System.runAs(usuarioMexico()) {
            r = ZapataFormatoFecha.formatear(new List<ZapataFormatoFecha.Peticion>{ p });
        }

        Assert.isTrue(r[0].texto.contains('a las '), 'Sin fin debe decir "a las": ' + r[0].texto);
    }

    @IsTest
    static void inicioNuloNoRevienta() {
        List<ZapataFormatoFecha.Respuesta> r = ZapataFormatoFecha.formatear(
            new List<ZapataFormatoFecha.Peticion>{ new ZapataFormatoFecha.Peticion() });

        Assert.areEqual('', r[0].texto, 'Sin inicio devuelve vacio, no una excepcion');
    }
}