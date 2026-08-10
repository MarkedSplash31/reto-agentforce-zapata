// Idempotente: solo crea/publica una version nueva cuando la version Online no
// lleva ya la marca sintetica. Knowledge no permite actualizar directamente una
// version publicada; el ciclo Draft -> update -> publish es obligatorio.
String targetVersion = 'v1.0-sintetica-no-verificada';
List<Knowledge__kav> online = [
    SELECT Id, KnowledgeArticleId, Version_Politica__c
    FROM Knowledge__kav
    WHERE PublishStatus = 'Online' AND IsLatestVersion = true
      AND (Version_Politica__c = null OR Version_Politica__c != :targetVersion)
    ORDER BY KnowledgeArticleId
];

Integer migrated = 0;
for (Knowledge__kav article : online) {
    List<Knowledge__kav> drafts = [
        SELECT Id, Version_Politica__c
        FROM Knowledge__kav
        WHERE KnowledgeArticleId = :article.KnowledgeArticleId
          AND PublishStatus = 'Draft'
        LIMIT 1
    ];
    if (drafts.isEmpty()) {
        KbManagement.PublishingService.editOnlineArticle(
            String.valueOf(article.KnowledgeArticleId),
            false
        );
        drafts = [
            SELECT Id, Version_Politica__c
            FROM Knowledge__kav
            WHERE KnowledgeArticleId = :article.KnowledgeArticleId
              AND PublishStatus = 'Draft'
            LIMIT 1
        ];
    }

    Knowledge__kav draft = drafts[0];
    if (draft.Version_Politica__c != targetVersion) {
        draft.Version_Politica__c = targetVersion;
        update draft;
    }
    KbManagement.PublishingService.publishArticle(
        String.valueOf(article.KnowledgeArticleId),
        false
    );
    migrated++;
}

System.debug(LoggingLevel.INFO, 'PROVENANCE_KNOWLEDGE_MIGRATED=' + migrated);
