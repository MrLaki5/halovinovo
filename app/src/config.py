from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql+asyncpg://postgres:postgres@db:5432/halovinovo"

    # The single host account, set in .env
    ADMIN_USERNAME: str
    ADMIN_PASSWORD: str

    # Signs the host's session cookie
    SESSION_SECRET_KEY: str
    SESSION_TTL_HOURS: int = 48

    # Shared with nginx, which serves it at /uploads/
    UPLOAD_DIR: str = "/app/uploads"
    MAX_UPLOAD_BYTES: int = 10 * 1024 * 1024

    class Config:
        env_file = ".env"


settings = Settings()
