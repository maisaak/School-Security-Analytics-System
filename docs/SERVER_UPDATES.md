# Обновления сервера из GitHub

Поддерживается нативная установка Ubuntu/Debian в `/opt/school-security`, ветка
`main`, origin `https://github.com/maisaak/School-Security-Analytics-System.git`,
системный пользователь `school-security`, стандартная SQLite и Nginx из инструкции.
Windows, Docker и PostgreSQL этим механизмом **не обновляются**.

## Однократная установка администратором

Сначала опубликуйте эти файлы в репозитории и установите их на сервер.
Выполняйте из корня проекта:

```bash
sudo install -d -o school-security -g school-security -m 750 /var/lib/school-security-updater
sudo install -o root -g root -m 755 deploy/update-server.sh /usr/local/sbin/school-security-update
sudo install -m 644 deploy/school-security-update.service /etc/systemd/system/
sudo install -m 644 deploy/school-security-update.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now school-security-update.timer
```

Добавьте в `.env` `SERVER_UPDATES_ENABLED=true`, перезапустите API.
В настройках администратора появятся проверка GitHub, установка и переключатель
автообновления. Запрос кнопки обрабатывается в течение минуты. Автообновление
по умолчанию выключено; включённый режим проверяет main каждую минуту.
Он разрешает выполнение кода из main: защитите ветку, GitHub-аккаунт и права push.

Перед обновлением проверяются origin, ветка и отсутствие локальных изменений.
При новой версии служба останавливает API, делает резервную копию SQLite/медиа,
применяет только fast-forward, устанавливает зависимости, собирает frontend,
запускает тесты, публикует assets и проверяет готовность API.
Предусмотрите окно обслуживания: камеры и сайт временно недоступны.

При ошибке до начала изменения кода (например, сбое резервного копирования)
скрипт пытается запустить исходный API. Это не откат и не гарантия готовности.
После начала изменения кода автоматический откат **не выполняется**: он опасен при изменениях
схемы данных. API может остаться остановленным. Выключите автообновление,
проверьте `journalctl -u school-security-update`, устраните причину или восстановите
код и резервную копию вручную, затем запустите `school-security`.
Копия не содержит `.env`; храните секреты отдельно. Не включайте режим на
сервере без проверенной процедуры восстановления и контроля свободного диска.

Служба root-owned; API не получает sudo и не передаёт команды/URL/ветки в shell.
После обновления скриптов или unit-файлов повторите их установку вручную.
На Windows проверка GitHub работает, установка остаётся отключённой.
