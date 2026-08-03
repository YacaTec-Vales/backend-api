## [0.1.0-rc.1](https://github.com/YacaTec-Vales/backend-api/compare/v0.0.0...v0.1.0-rc.1) (2026-08-03)

### Features

* **app:** añadir bootstrap con helmet cors y shutdown ([f0e33ae](https://github.com/YacaTec-Vales/backend-api/commit/f0e33ae3cdf44e9d5652e701e2ac5376f0b7ff41))
* **auth:** añadir forgot-password y reset-password ([0cf1636](https://github.com/YacaTec-Vales/backend-api/commit/0cf1636e272ba765398a664048c764d8fe0b04b4))
* **auth:** implementar login refresh logout y me ([1723dc7](https://github.com/YacaTec-Vales/backend-api/commit/1723dc7956ac81ee9cd8f803106912bac7b18571))
* bootstrap del proyecto NestJS 11 con configuración base ([a84ab84](https://github.com/YacaTec-Vales/backend-api/commit/a84ab84360e039e301bd0c97607d66f6f463ab57))
* **config:** añadir namespaces con validacion joi ([bec7ddf](https://github.com/YacaTec-Vales/backend-api/commit/bec7ddf6617cda89e26438cad3327ff60403710a))
* **config:** exponer documentacion openapi y ui de scalar ([d0ed4ae](https://github.com/YacaTec-Vales/backend-api/commit/d0ed4ae7d56155a7d8c1889a11b6da4812b62150))
* **database:** separar conexion de bd en pools de lectura y escritura ([c9bf781](https://github.com/YacaTec-Vales/backend-api/commit/c9bf781b483f34bea0164d1ba911ec2f85967fcc))
* **db:** integrar drizzle orm con schema de tablas app ([6c177fa](https://github.com/YacaTec-Vales/backend-api/commit/6c177facb202792f499b5d258352439432f9c90c))
* **health:** añadir liveness y readiness para balanceador ([21612c8](https://github.com/YacaTec-Vales/backend-api/commit/21612c83bd46757076ea2975cbcae43863bedc00))
* **mail:** añadir envio de emails con handlebars ([9fb4a9c](https://github.com/YacaTec-Vales/backend-api/commit/9fb4a9cb2cca3b689faa493551f685b37e0df29b))
* **mail:** implement mail logging and notification dispatching system ([4bb244f](https://github.com/YacaTec-Vales/backend-api/commit/4bb244f261fc852ac233a708a11c88543811e288))
* **mfa:** añadir modulo tfa con totp y backup codes ([36d343d](https://github.com/YacaTec-Vales/backend-api/commit/36d343d4f7c55d9f821554193b2dd692b12788a3))
* **sessions:** añadir listado y revocacion de sesiones ([963b853](https://github.com/YacaTec-Vales/backend-api/commit/963b853103da6d740451b17e7f91e481914aacad))
* **shared:** anadir decoradores guards y filter global ([3d14b5f](https://github.com/YacaTec-Vales/backend-api/commit/3d14b5f0c5adf69610591a68ddf4708f498a8c3a))
* **shared:** añadir error response dto para openapi ([afb0de6](https://github.com/YacaTec-Vales/backend-api/commit/afb0de68c1c4c6a041214046c16d046332b76a67))
* **users:** modulo CRUD administrativo con auditoria y reset por correo ([95d73dd](https://github.com/YacaTec-Vales/backend-api/commit/95d73dd3291d8948c8122b1a9f28a6f7ded72fc5))

### Bug Fixes

* **auth:** parametrizar sql crudo en mfa service para evitar inyeccion ([bc328e8](https://github.com/YacaTec-Vales/backend-api/commit/bc328e80a5e517ba74620600e687ad64aa97e8a1))
* **ci:** no persistir credenciales del bot en checkout ([8db3f18](https://github.com/YacaTec-Vales/backend-api/commit/8db3f1833d08a13cc5209599e1503a36e82c0ff8))
* **ci:** usar PAT para bypass del ruleset en auto release ([d547b3a](https://github.com/YacaTec-Vales/backend-api/commit/d547b3a3c06ae86c79c937ea49264e0a4772c1d1))
* **config:** permitir cargar la ui de scalar bajo la csp de helmet ([5fbb819](https://github.com/YacaTec-Vales/backend-api/commit/5fbb8194202748a7139437dc421feb798a3c5938))
* **deps:** fijar conventional-changelog-conventionalcommits para generar notas de release ([#11](https://github.com/YacaTec-Vales/backend-api/issues/11)) ([90b3ca9](https://github.com/YacaTec-Vales/backend-api/commit/90b3ca92711a4b423bbfb6c3b29b3d8114f70425))
* **deps:** regenerar package-lock.json para sincronizar con package.json ([#1](https://github.com/YacaTec-Vales/backend-api/issues/1)) ([adc03a3](https://github.com/YacaTec-Vales/backend-api/commit/adc03a3dfa9e1d84bf8f031f80913a856f8984a6))
