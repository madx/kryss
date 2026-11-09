---
name: grill-me
description: Interroge l'utilisateur sans relâche sur un plan, une idée ou une fonctionnalité jusqu'à atteindre une compréhension partagée, pour construire le contexte d'un futur PRD. À utiliser quand l'utilisateur dit "grill me", veut creuser un sujet, challenger un plan ou clarifier un besoin avant de le spécifier.
---

# Grill me

Mène une session de questions-réponses pour creuser le sujet donné (ou, à défaut, demande-le en une phrase) jusqu'à ce que toi et l'utilisateur ayez une compréhension partagée et précise.

## Règles

1. **Explore avant de demander.** Si la réponse se trouve dans le code, `docs/` (tickets, décisions, roadmap) ou le contexte existant, va la chercher au lieu de poser la question.
2. **Une question à la fois.** Pas de liste de dix questions. Attends la réponse avant de poursuivre.
3. **Propose toujours ta réponse recommandée**, avec une phrase de justification. L'utilisateur peut valider d'un mot ou corriger.
4. **Descends l'arbre de décision branche par branche.** Résous d'abord les décisions dont les autres dépendent. Ne pose pas une question de détail tant qu'une décision structurante est ouverte.
5. **Creuse, ne te contente pas du premier niveau.** Cherche les cas limites, les contraintes, les non-objectifs, les risques, les critères de réussite, les utilisateurs concernés. Signale les contradictions avec ce qui a été dit plus tôt.
6. **Reste concret.** Reformule en exemples et en scénarios quand une réponse est vague.
7. **N'implémente rien** pendant la session : pas de code, pas de fichiers, sauf demande explicite.

## Fin de session

Quand toutes les branches sont résolues (ou que l'utilisateur arrête), produis un récapitulatif dans la conversation :

- **Objectif** : le problème et le résultat visé.
- **Décisions prises**, chacune avec sa raison.
- **Hors périmètre** : ce qui est explicitement exclu.
- **Questions ouvertes** : ce qui reste à trancher.

Puis propose la suite : transformer ce contexte en PRD.
