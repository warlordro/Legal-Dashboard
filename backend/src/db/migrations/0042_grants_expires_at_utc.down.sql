-- Normalizare de date: offsetul original nu mai exista dupa conversie, deci
-- down-ul nu poate reconstitui forma initiala. Valorile UTC raman corecte
-- semantic (acelasi instant), asa ca down-ul curata doar versiunea.
DELETE FROM _schema_versions WHERE version = 42;
