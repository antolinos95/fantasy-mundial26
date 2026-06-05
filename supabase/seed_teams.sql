-- Ejecutar SOLO esto si la tabla teams ya existe con fifa_code NOT NULL
-- Si quieres limpiar primero: DELETE FROM teams;

INSERT INTO teams (name, flag_emoji, group_name, fifa_code) VALUES
-- Grupo A
('Estados Unidos',  '🇺🇸', 'A', 'USA'),
('México',          '🇲🇽', 'A', 'MEX'),
('Panamá',          '🇵🇦', 'A', 'PAN'),
-- Grupo B
('Canadá',          '🇨🇦', 'B', 'CAN'),
('Honduras',        '🇭🇳', 'B', 'HON'),
('Jamaica',         '🇯🇲', 'B', 'JAM'),
-- Grupo C
('Argentina',       '🇦🇷', 'C', 'ARG'),
('Chile',           '🇨🇱', 'C', 'CHI'),
('Perú',            '🇵🇪', 'C', 'PER'),
-- Grupo D
('Brasil',          '🇧🇷', 'D', 'BRA'),
('Ecuador',         '🇪🇨', 'D', 'ECU'),
('Bolivia',         '🇧🇴', 'D', 'BOL'),
-- Grupo E
('Colombia',        '🇨🇴', 'E', 'COL'),
('Uruguay',         '🇺🇾', 'E', 'URU'),
('Venezuela',       '🇻🇪', 'E', 'VEN'),
-- Grupo F
('Paraguay',        '🇵🇾', 'F', 'PAR'),
('Marruecos',       '🇲🇦', 'F', 'MAR'),
('Senegal',         '🇸🇳', 'F', 'SEN'),
-- Grupo G
('Egipto',          '🇪🇬', 'G', 'EGY'),
('Nigeria',         '🇳🇬', 'G', 'NGA'),
('Sudáfrica',       '🇿🇦', 'G', 'RSA'),
-- Grupo H
('Costa de Marfil', '🇨🇮', 'H', 'CIV'),
('Camerún',         '🇨🇲', 'H', 'CMR'),
('DR Congo',        '🇨🇩', 'H', 'COD'),
-- Grupo I
('Alemania',        '🇩🇪', 'I', 'GER'),
('España',          '🇪🇸', 'I', 'ESP'),
('Portugal',        '🇵🇹', 'I', 'POR'),
-- Grupo J
('Francia',         '🇫🇷', 'J', 'FRA'),
('Inglaterra',      '🏴󠁧󠁢󠁥󠁮󠁧󠁿', 'J', 'ENG'),
('Países Bajos',    '🇳🇱', 'J', 'NED'),
-- Grupo K
('Italia',          '🇮🇹', 'K', 'ITA'),
('Bélgica',         '🇧🇪', 'K', 'BEL'),
('Croacia',         '🇭🇷', 'K', 'CRO'),
-- Grupo L
('Suiza',           '🇨🇭', 'L', 'SUI'),
('Austria',         '🇦🇹', 'L', 'AUT'),
('Turquía',         '🇹🇷', 'L', 'TUR'),
-- Grupo M
('Dinamarca',       '🇩🇰', 'M', 'DEN'),
('Escocia',         '🏴󠁧󠁢󠁳󠁣󠁴󠁿', 'M', 'SCO'),
('Serbia',          '🇷🇸', 'M', 'SRB'),
-- Grupo N
('Polonia',         '🇵🇱', 'N', 'POL'),
('Rumanía',         '🇷🇴', 'N', 'ROU'),
('Hungría',         '🇭🇺', 'N', 'HUN'),
-- Grupo O
('Japón',           '🇯🇵', 'O', 'JPN'),
('Corea del Sur',   '🇰🇷', 'O', 'KOR'),
('Australia',       '🇦🇺', 'O', 'AUS'),
-- Grupo P
('Irán',            '🇮🇷', 'P', 'IRN'),
('Arabia Saudita',  '🇸🇦', 'P', 'KSA'),
('Irak',            '🇮🇶', 'P', 'IRQ')
ON CONFLICT DO NOTHING;
