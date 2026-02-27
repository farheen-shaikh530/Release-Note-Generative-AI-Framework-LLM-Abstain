import os
from functools import lru_cache
from pydantic import BaseSettings, AnyHttpUrl


class Settings(BaseSettings):
    environment: str = os.getenv("ENVIRONMENT", "local")

    # Releasetrain endpoints
    releasetrain_vendor_api: AnyHttpUrl = "https://releasetrain.io/api/c/names"
    releasetrain_component_api: AnyHttpUrl = "https://releasetrain.io/api/component?q=os"

    # LLM / tools
    openai_api_key: str = os.getenv("OPENAI_API_KEY", "")
    openai_model: str = os.getenv("OPENAI_MODEL", "gpt-4.1-mini")
    tavily_api_key: str = os.getenv("TAVILY_API_KEY", "")

    # Neo4j (optional)
    neo4j_uri: str = os.getenv("NEO4J_URI", "")
    neo4j_user: str = os.getenv("NEO4J_USER", "")
    neo4j_password: str = os.getenv("NEO4J_PASSWORD", "")

    class Config:
        env_file = ".env"
        case_sensitive = False


@lru_cache()
def get_settings() -> Settings:
    return Settings()


SETTINGS = get_settings()

