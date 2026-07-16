FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build

WORKDIR /src
COPY . .

ARG PROJECT
RUN dotnet restore "$PROJECT"
RUN dotnet publish "$PROJECT" --configuration Release --output /app/publish --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime

WORKDIR /app
COPY --from=build /app/publish .

ARG APP_DLL
ENV METAENGINE_APP_DLL=$APP_DLL

ENTRYPOINT ["sh", "-c", "exec dotnet \"$METAENGINE_APP_DLL\" \"$@\"", "--"]
