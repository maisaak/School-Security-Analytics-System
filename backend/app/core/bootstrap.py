"""Opt-in first-run administrator creation shared by every deployment mode."""
import logging
import re

from sqlalchemy.exc import IntegrityError

from app.core.accounts import hash_password
from app.core.config import settings
from app.db.models import Employee
from app.db.session import SessionLocal

logger = logging.getLogger(__name__)


def bootstrap_admin() -> None:
    password = settings.BOOTSTRAP_ADMIN_PASSWORD.get_secret_value()
    if not password:
        return  # Existing installations retain API-key first-login support.
    username = settings.BOOTSTRAP_ADMIN_USERNAME
    if not re.fullmatch(r"[a-z0-9][a-z0-9_.-]{2,63}", username):
        raise RuntimeError("Invalid BOOTSTRAP_ADMIN_USERNAME (3–64 lowercase login characters required)")
    with SessionLocal() as db:
        if db.query(Employee).filter(Employee.username == username).first():
            logger.info("Bootstrap account already exists; credentials and permissions unchanged")
            return
        if not 12 <= len(password) <= 256:
            raise RuntimeError("BOOTSTRAP_ADMIN_PASSWORD must contain 12–256 characters")
        db.add(Employee(username=username, display_name="Администратор", role="admin",
                        password_hash=hash_password(password), is_active=True))
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            # A concurrent first start may have inserted this same login.
            if not db.query(Employee).filter(Employee.username == username).first():
                raise
            logger.info("Bootstrap account already exists; credentials and permissions unchanged")
            return
    logger.info("Bootstrap administrator created; sign in using the configured credentials")
