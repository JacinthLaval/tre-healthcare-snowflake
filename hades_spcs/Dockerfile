# HADES for Snowpark Container Services
# Based on official OHDSI HADES image with Snowflake JDBC driver

FROM rocker/rstudio:4.2.1
LABEL maintainer="TRE Healthcare"
LABEL description="OHDSI HADES for Snowflake SPCS"

# Install OS dependencies including Java and Python
RUN apt-get update && apt-get install -y \
    openjdk-11-jdk \
    liblzma-dev \
    libbz2-dev \
    libncurses5-dev \
    curl \
    python3-dev \
    python3-venv \
    libcurl4-openssl-dev \
    libssl-dev \
    libxml2-dev \
    && R CMD javareconf \
    && rm -rf /var/lib/apt/lists/*

# Install utility R packages
RUN install2.r --error \
    openssl \
    httr \
    xml2 \
    remotes \
    rJava \
    && rm -rf /tmp/download_packages/ /tmp/*.rds

# Install OHDSI DatabaseConnector first
RUN R -e "remotes::install_github('OHDSI/DatabaseConnector', upgrade = 'never')"

# Set up JDBC drivers folder
ENV DATABASECONNECTOR_JAR_FOLDER="/opt/hades/jdbc_drivers"
RUN mkdir -p /opt/hades/jdbc_drivers

# Download Snowflake JDBC driver
RUN R -e "DatabaseConnector::downloadJdbcDrivers('snowflake', pathToDriver = '/opt/hades/jdbc_drivers')"

# Install core HADES packages
RUN R -e "remotes::install_github('OHDSI/SqlRender', upgrade = 'never')"
RUN R -e "remotes::install_github('OHDSI/ParallelLogger', upgrade = 'never')"
RUN R -e "remotes::install_github('OHDSI/Andromeda', upgrade = 'never')"
RUN R -e "remotes::install_github('OHDSI/FeatureExtraction', upgrade = 'never')"
RUN R -e "remotes::install_github('OHDSI/Cyclops', upgrade = 'never')"
RUN R -e "remotes::install_github('OHDSI/CohortGenerator', upgrade = 'never')"

# Install analytics packages
RUN R -e "remotes::install_github('OHDSI/Achilles', upgrade = 'never')"
RUN R -e "remotes::install_github('OHDSI/DataQualityDashboard', upgrade = 'never')"
RUN R -e "remotes::install_github('OHDSI/CohortDiagnostics', upgrade = 'never')"

# Install Shiny for result viewing
RUN install2.r --error \
    shiny \
    shinydashboard \
    DT \
    plotly \
    && rm -rf /tmp/download_packages/ /tmp/*.rds

# Copy Snowflake connection helper
COPY snowflake_connection.R /opt/hades/snowflake_connection.R

# Set environment variables
ENV DISABLE_AUTH=true
ENV ROOT=TRUE

# Expose RStudio port
EXPOSE 8787

# Start RStudio Server
CMD ["/init"]
