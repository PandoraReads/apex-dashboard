# Apex Dashboard

> Arrêtez de jongler entre vos notes Obsidian. Une seule page. Tout ce qu'il vous faut. Notez vos idées, venez à bout de vos todos, suivez vos projets — et donnez-leur une allure spectaculaire.

## Capture d'écran

![Apex Dashboard](screenshot1.png)

**Langue / Language**: [English](README_EN.md) | [简体中文](../README.md) | [繁體中文](README_zh-TW.md) | [日本語](README_ja.md) | [한국어](README_ko.md) | [Español](README_es.md) | **Français** | [Deutsch](README_de.md) | [Português (Brasil)](README_pt-BR.md) | [Русский](README_ru.md) | [ไทย](README_th.md)

## Fonctionnalités

### 🗒️ Mémo
Capturez vos pensées instantanément avec un bloc-notes intégré. Chaque carte mémo dispose d'une zone de texte inscriptible — notez vos idées, comptes rendus de réunion ou réflexions du jour sans quitter votre tableau de bord. Prend en charge les `[[wikilinks]]` qui s'affichent sous forme de liens cliquables.

### ✅ Todo
Gérez vos tâches avec des checklists interactives. Ajoutez, réorganisez, glissez-déposez et cochez vos tâches. Une barre de progression affiche le pourcentage d'avancement d'un coup d'œil. Les éléments todo prennent également en charge les `[[wikilinks]]` pour référencer vos notes.

### 📁 Projets
Organisez les documents de votre coffre en cartes de projet. Chaque carte renvoie vers les notes associées, affiche une image de couverture (les images locales du coffre comme les URL web sont prises en charge) et propose une recherche de document intégrée pour ajouter rapidement de nouveaux fichiers. Gérez plusieurs types de fichiers : notes Markdown, PDF, images, audio et vidéo.

### 📝 Notes
Une section compacte, sous forme de liste, pour organiser vos documents de référence et vos fichiers d'accès rapide. Affiche jusqu'à 5 cartes par rangée, sans images de couverture, pour une densité maximale.

### 📅 Calendrier
Un calendrier natif en grille mensuelle regroupant toutes les tâches datées de votre coffre (sans Dataview ni plugin externe). Chaque case de journée liste ses tâches ; cliquez sur un jour pour voir son agenda. Ouvrez un calendrier plein écran avec navigation par mois et bascule intégrée. Les événements pluri-jours avec `[start::]` / `[end::]` s'étendent sur plusieurs jours. La vue agrandie du widget de la barre latérale est également disponible sous forme de **section Calendrier** intégrée au tableau — grille mensuelle complète (avec barres pluri-jours), grille horaire hebdomadaire, filtre de tâches et retour à aujourd'hui ; cliquez sur un numéro de jour pour ajouter une tâche à ce jour (écrite dans la note quotidienne ou la liste de todos du tableau de bord).

### 🔍 Dataview
Interrogez votre coffre avec un moteur DQL intégré — aucun plugin Dataview requis. Ajoutez une section Dataview et écrivez des requêtes comme `TABLE file.name, rating FROM "Books" WHERE rating >= 4 SORT rating DESC`. Prend en charge les sorties `TABLE`, `LIST`, `TASK`, `CALENDAR` et `HEATMAP` sur les dossiers, tags et liens (`FROM`), avec les clauses `WHERE`, `SORT`, `GROUP BY`, `FLATTEN` et `LIMIT`, environ 40 fonctions intégrées, tous les champs implicites `file.*`, le frontmatter YAML et les champs en ligne (`[key:: value]`). La fenêtre de configuration valide la syntaxe en temps réel et fournit des requêtes d'exemple en un clic. Les cases à cocher `TASK` répercutent l'état dans la note source, `CALENDAR` trace une grille mensuelle et `HEATMAP` trace une grille de contributions annuelle à partir de n'importe quel champ numérique. Les résultats s'actualisent à la demande via le bouton d'actualisation de la section.

### 🌐 Web
Intégrez n'importe quelle page web directement dans une section — collez une URL et naviguez comme dans un panneau de navigateur intégré au tableau. Le **mode Auto** vérifie au préalable la politique d'intégration du site : les sites autorisant l'encapsulation s'affichent directement dans une iframe, tandis que les sites qui refusent basculent vers une webview de bureau (avec sa connexion persistante propre — recommandé pour Keep, Todoist web et autres applications nécessitant une connexion) ; sur mobile, une carte de secours avec bouton « ouvrir dans le navigateur » s'affiche. Vous pouvez également forcer le mode iframe/webview et ajuster l'échelle de la page de 0,5 à 2× pour les applications web denses. Privilégiez les sites https sur mobile ; l'intégration est orientée lecture — les popups et téléchargements ont leur place dans un vrai navigateur.

### 📡 RSS
Abonnez-vous à des blogs et flux d'actualités directement sur le tableau : ajoutez n'importe quel lien RSS 2.0 / Atom et les derniers articles de tous les flux convergent dans une liste unique anti-chronologique (tags de source, points non-lus), avec un filtre des non-lus et un bouton « tout marquer comme lu ». Cliquez sur un article pour le lire en entier dans une fenêtre modale — les flux fournissant le texte complet s'affichent directement, les flux limités au résumé sont récupérés et leur contenu principal extrait automatiquement. Chaque article dispose d'un bouton de téléchargement qui l'enregistre sous forme de note dans le coffre (nom préfixé par la date, frontmatter de source, lien original) dans le dossier configuré ; les articles enregistrés renvoient directement à la note. Le contenu des flux est mis en cache localement pendant 30 minutes ; les états « lu » et « enregistré » persistent d'une session à l'autre.

### 🖼️ Bibliothèque de matériel
Une vue plein écran dédiée (icône sparkle du ruban ou palette de commandes) qui rassemble toutes les images, vidéos et textes avec couverture du coffre dans une cascade libre. Recherche, filtre par type, filtre par tags, groupement par dossier/tag/type, favoris et deux styles de carte (couverture simple / polaroïd façon Pin) ; la visionneuse offre le zoom à la molette, le déplacement par glisser et l'étirement des vidéos, et liste les notes référençant l'élément avec un saut en un clic. La barre d'actions à droite envoie des compétences, étiquette en lot (les tags existants sont à un clic), déplace, archive (destination configurée dans les réglages), copie les chemins et supprime ; glissez-déposez des images ou vidéos depuis l'extérieur du coffre et elles sont copiées selon les règles de regroupement. Portée d'analyse, dossier de dépôt et dossier d'archivage se règlent dans les paramètres de la bibliothèque.

### ⚡ Actions rapides
Épinglez vos raccourcis les plus utilisés dans la barre latérale. Deux types d'actions sont pris en charge : les liens **Fichier** pour ouvrir n'importe quel document, et les raccourcis **Commande** pour déclencher n'importe quelle commande Obsidian. Inclut des préréglages intégrés pour Nouveau journal et Nouvelle note.

### 🌤️ Widgets de la barre latérale
La barre latérale gauche propose 11 widgets activables indépendamment et réorganisables par glisser-déposer :

- **Météo** — Météo en temps réel avec température actuelle, ressenti, humidité, vitesse du vent et prévisions sur 5 jours avec températures maximales/minimales quotidiennes. Propulsée par Open-Meteo (aucune clé API requise). Recherche de ville avec autocomplétion géocodée pour un emplacement précis
- **Almanach lunaire** — Date lunaire chinoise traditionnelle, fêtes et conseils du jour (à faire / à éviter)
- **Minuteur Pomodoro** — Un minuteur de concentration avec sélecteur d'activité et cycles travail/pause, plus un graphique en anneau du découpage du jour ; la vue statistiques ajoute la progression de l'objectif, un score d'efficacité, des graphiques de tendance, une heatmap sur 12 semaines et une frise du jour
- **Suivi de lecture** — Suivez vos sessions de lecture avec un minuteur intégré. Ajoutez des livres via la recherche Douban ou une saisie manuelle, chronométrez vos sessions et enregistrez la progression avec les numéros de pages. Chaque carte livre affiche l'image de couverture, l'auteur et une barre de progression de lecture
- **Compte à rebours** — Comptes à rebours personnalisables vers n'importe quelles dates cibles, affichés en jours ou en heures restantes
- **Progression de l'année** — Quelle part de l'année en cours s'est déjà écoulée
- **Calendrier** — Grille mois/semaine agrégeant toutes les tâches datées du coffre ; cliquez sur un jour pour voir son agenda et ajoutez des tâches qui s'écrivent dans la note quotidienne du jour ; les événements pluri-jours s'étendent sur plusieurs jours
- **Check-in d'habitudes** — Cochements quotidiens par habitude, avec rattrapage de la veille, séries (streaks) et statistiques en heatmap
- **Suivi des dépenses** — Saisie rapide de dépenses/revenus (notes, antidatage, catégories personnalisées) avec totaux du jour et statistiques semaine/mois/année/depuis toujours ; le grand livre ajoute le filtrage, l'édition en ligne et l'import/export CSV
- **Album photo** — Un cadre photo numérique pour n'importe quel dossier du coffre : rotation automatique avec pause au survol, précédent/suivant manuel et badge d'index, ratio de panneau 1:1 ou 3:4, quatre transitions (fondu / poussée gauche / poussée droite / zoom), intervalle de 3 à 60 s, sous-dossiers inclus par défaut. La photo d'ouverture est semée par l'heure (jamais toujours la même), la suivante est préchargée, et les ajouts/suppressions/renommages dans le coffre actualisent la liste sans perdre votre position
- **Musique** — Recherchez et lisez des titres libres de NetEase Cloud Music depuis la barre latérale : connexion facultative à un compte NetEase dans les réglages pour les titres membres autorisés par le compte, import d'une playlist par lien, contrôles de volume et de répétition, playlist persistante avec rechargement différé des pochettes, et une barre de mini-lecteur flottante facultative qui continue de fonctionner quand le tableau de bord est fermé (bureau uniquement)

La barre latérale accueille aussi la **bande calendrier de la semaine** (7 jours compacts, aujourd'hui mis en évidence), les **documents récents** et le bouton **retour en haut** ; les téléphones bénéficient de la même barre de widgets, et les données des widgets fusionnent par union entre appareils.

### 🎨 Bannière
Une bannière personnalisable avec une citation inspirante et une image d'arrière-plan facultative. Prend en charge les images locales du coffre comme les URL web. Double-cliquez pour modifier.

### 🔄 Glisser-déposer
Déplacez les cartes entre les sections pour réorganiser votre espace de travail. Faites glisser les tâches au sein des cartes Todo pour les réordonner. Faites glisser les liens de documents entre les cartes projet/note.

### 🧩 Sections personnalisées
**15 types de sections** à combiner à volonté — **Todo**, **Mémo**, **Notes repositionnables (Sticky)**, **Notes (cartes projet)**, **Notes (sans couverture)**, **Dataview**, **Bibliothèque**, **Dossier**, **Images**, **Vidéos**, **Calendrier**, **Weread**, **TickTick**, **Web** et **RSS** — chacune avec sa propre mise en page et son propre comportement, pour que le tableau épouse votre flux de travail.

### 🕐 Documents récents
La barre latérale affiche les fichiers récemment modifiés avec des horodatages relatifs, pour replonger aussitôt dans votre dernier travail.

## Thèmes

![Aperçu des thèmes](screenshot2.png)
![Aperçu des thèmes](screenshot3.png)

13 thèmes façonnés à la main, chacun avec une identité visuelle distincte :

| Thème | Style |
|-------|-------|
| **Earth** | Soleil toscan : parchemin parcouru de nappes chaudes dérivantes toutes les 32 s, accent terracotta et notes olive |
| **Nordic** | Fjord polaire : nappes d'aurore givrées sur un blanc froid, accent bleu glacier |
| **Pony** | Arc-en-ciel MLP haut en saturation : six bandes d'aurore bonbon sur un ciel nocturne, une teinte poney par section |
| **Blossom** | Éclat de verre rosé, sections transparentes |
| **Lilac** | Massif impressionniste : nappes dérivantes lentes de 28 s derrière des cartes ivoire translucides, accent glycine |
| **Island** (défaut) | Pastels Animal Crossing, vert forêt et bleu océan |
| **Tundra** | Gris froid + aurore vert avocat, cartes de verre sauge |
| **Matcha** | Esthétique du bol de thé : nappes de jardin de thé de 26 s, cartes en céramique crème, accent matcha profond aux notes dorées |
| **Vermilion** | Minimalisme à l'encre : fond papier de riz et encre sumi, dérive d'encre de 40 s, un seul accent rouge vermillon façon sceau |
| **Neon** | Presque noir avec accent magenta néon, identique en mode clair et sombre |
| **Volt** | Presque noir avec accent cyan électrique, identique en mode clair et sombre |
| **Magma** | Presque noir chaud avec accent orange lave, identique en mode clair et sombre |
| **Onyx** | Noir pur avec accent citron, identique en mode clair et sombre |

Tous les thèmes prennent en charge les modes clair et sombre d'Obsidian.

## Réglages

- **Fichier du tableau de bord** — personnalisez le chemin du fichier de données de votre tableau de bord
- **Style** — choisissez parmi 13 thèmes visuels
- **Langue** — interface en anglais ou en chinois
- **Nombre de documents récents** — contrôlez le nombre de fichiers récents affichés
- **Widgets de la barre latérale** — Météo, Heatmap, Pomodoro, Lecture, Compte à rebours. Activez/désactivez et configurez chaque widget indépendamment
- **Réglages de lecture** — Activer/désactiver le suivi de lecture, activer/désactiver le son de fin de session

## Installation

### Depuis les plugins communautaires d'Obsidian
1. Ouvrez Réglages > Plugins communautaires
2. Parcourez et recherchez « Apex Dashboard »
3. Cliquez sur Installer, puis Activer

### Installation manuelle
1. Téléchargez la dernière version depuis [GitHub Releases](https://github.com/pandorareads/apex-dashboard/releases)
2. Extrayez dans le dossier `.obsidian/plugins/apex-dashboard/` de votre coffre
3. Ouvrez Réglages > Plugins communautaires et activez « Apex Dashboard »

## Utilisation

1. Ouvrez le tableau de bord via l'icône du ruban (icône accueil) ou la palette de commandes : `Apex Dashboard: Open dashboard`
2. Un fichier `dashboard.md` est automatiquement créé à la racine de votre coffre
3. Toutes les modifications sont enregistrées directement dans le fichier — ce sont vos données, en texte brut

> **Remarque :** la suppression, le renommage ou la réorganisation des sections doivent se faire en éditant directement le fichier `dashboard.md`. Toute modification apportée à la note prend effet immédiatement dans la vue du tableau de bord.

## ☕ Offrez-moi un café

Si Apex Dashboard rend votre quotidien Obsidian plus fluide, pensez à m'offrir un café pour soutenir le développement continu.

<p align="center">
  <img src="buy-me-a-coffee.png" alt="Buy Me a Coffee" width="640">
</p>

## Nouveautés

### 3.9.3
- **Archivage dans la bibliothèque de matériel** — un nouveau bouton d'archivage dans la barre d'actions droite déplace la sélection vers le dossier d'archivage configuré ; une notification invite à le régler s'il est vide
- **Notes référencées dans la visionneuse** — la vue image/vidéo liste en bas toutes les notes qui lient ou intègrent l'élément, avec un saut en un clic
- **Étiquetage plus fluide** — la popup d'étiquetage en lot propose les tags existants en un clic ; les tags du filtre passent sur plusieurs lignes avec troncature des noms longs, et le bouton d'effacement corrige son libellé et apparaît dès qu'un filtre est actif
- **Les clics suivent les réglages de l'espace** — les cartes texte de la bibliothèque s'ouvrent selon le même réglage pop-over/onglet que les cartes du tableau de bord
- **Stabilité du rendu** — les changements de filtre et de page se peignent en une seule passe (pré-sonde des ratios et réutilisation des éléments d'image), réduisant les sauts à l'écran

### 3.9.2
- **Changement de thème instantané dans la bibliothèque de médias** — la page des médias applique désormais le nouveau thème en place dès que vous changez le thème du plugin, à l'identique du tableau de bord, sans fermer ni rouvrir ; les couleurs personnalisées, l'image d'arrière-plan et les réglages d'apparence s'appliquent maintenant aussi à la page des médias
- **Filtre de type replié en un menu déroulant** — le filtre image/vidéo/texte devient un unique bouton déroulant pour apaiser la barre d'outils, et la pagination s'aplatit, si bien que chaque média reste directement accessible
- **Nouvelle palette de la bande de base des cartes** — la bande méta inférieure de la carte polaroïd utilise désormais un jeu de couleurs choisi à la main, commun aux modes clair et sombre

### 3.9.1
- **Suppression de la limite de 500 de la bibliothèque de médias** — l'ancien plafond dur de 500 éléments par rendu rendait les médias au-delà inaccessible et, en vue groupée, faisait perdre des dossiers entiers ; désormais : la vue en mosaïque pagine jusqu'à tous les médias, la vue groupée rend chaque groupe progressivement (premier lot de 50 + « en voir plus »), et les groupes repliés ne construisent aucun contenu — les très grands coffres ne perdent plus de médias et ne montent plus des dizaines de milliers de nœuds d'un coup
- **Déplacement par glissement dans les groupes de dossiers** — dans la vue groupée par dossiers, glissez une carte de média vers un autre groupe pour déplacer le fichier : plusieurs cartes sélectionnées se déplacent en lot, les conflits de noms identiques sont ignorés automatiquement avec notification, et au survol du groupe cible s'affiche « relâchez pour déplacer vers ×× »
- **Correction de la disposition des colonnes groupées** — une fois la détection du ratio d'aspect des images terminée, chaque groupe réorganise désormais ses colonnes en cascade (auparavant, seul le premier groupe se réorganisait)

### 3.9.0
- **Bibliothèque de médias entièrement nouvelle** — l'icône square-sparkles débarque dans la zone fonctionnelle de gauche et ouvre une bibliothèque de médias pleine page : les images, vidéos et notes à couverture du coffre convergent toutes dans une cascade unique
- **Deux styles de cartes** — bascule en un clic entre la carte couverture d'origine et la carte polaroïd style Pin, trois niveaux de densité, navigation groupée par dossier, étiquette ou type ; la vue groupée offre un rail de navigation latéral gauche et un repli en un clic
- **Favoris** — touchez le cœur sur une carte pour ajouter un médium aux favoris, et le bouton cœur de la barre d'outils ne montre que les favoris en un clic
- **Organisation par lot** — sélection multiple par glissement de cadre, et le rail d'icônes fonctionnelles de droite applique les étiquettes, déplacements, copies de chemin et suppressions par lot
- **Liaison Agent** — envoyez les médias sélectionnés en un clic vers une compétence Agent, le chemin étant automatiquement injecté dans le modèle de prompt
- **Déposez, c'est enregistré** — glissez des images/vidéos depuis n'importe où sur l'ordinateur : elles sont copiées dans le coffre automatiquement, rangées selon le groupe cible et étiquetées ; l'emplacement de stockage par défaut se configure dans les réglages

### 3.8.11
- **Extension de l'interface multilingue** — ajout du japonais, coréen, espagnol, français, allemand, portugais brésilien, russe et thaï ; avec le chinois simplifié, le chinois traditionnel et l'anglais, l'interface prend en charge 11 langues ; les nouvelles installations suivent la langue d'Obsidian, et le changement reste possible via les réglages ou la liste de sélection de langue, les traductions étant embarquées hors ligne
- **Apparence de l'espace de travail immersif** — l'image de fond se règle indépendamment de l'espace de travail ordinaire, et la police ainsi que la couleur de l'horloge supérieure sont personnalisables ; l'entrée d'édition est rangée sous le bouton d'édition de la mise en page
- **Mode de comptage des habitudes** — une habitude peut basculer en comptage par clics répétés ; le widget affiche le compteur du jour et le panneau de statistiques permet de consulter les données cumulées et de changer de mode
- **Lien de saut des groupes de propriétés** — dans les sections dossier ou base de données groupées par propriété de lien bidirectionnel, cliquer sur le nom du groupe ouvre la note cible
- **Corrections du compte à rebours et du web** — interaction de sélection de l'heure cible du compte à rebours corrigée ; la connexion Google OAuth bascule vers le navigateur externe pour poursuivre l'habilitation
- **Affichage multilingue complété** — calendrier, météo, calendrier lunaire et progression annuelle suivent désormais la langue courante de l'interface

### 3.8.8
- **Pipeline d'archivage sécurisé** — L'archivage déplace désormais d'abord le fichier, vérifie que le renommage a bien eu lieu (avec une nouvelle tentative automatique), et seulement ensuite inscrit le statut : les déplacements silencieusement défaillants sur les coffres synchronisés iCloud ne laissent plus une note à moitié archivée coincée dans son dossier d'étape (quatre occurrences diagnostiquées). Un déplacement qui échoue se fait entendre et laisse la carte sur le tableau : un clic de plus suffit pour réessayer. Les déplacements par glissement d'étape bénéficient de la même protection
- **Réorganisation par glissement des boutons de compétence corrigée** — Cause racine trouvée : même quand le glissement natif de la carte est annulé, Chromium relâche toujours la capture du pointeur du bouton, tuant les écouteurs move/up propres au bouton dès que le pointeur quitte les 22 px du bouton — exactement ce dont une réorganisation entre boutons a besoin. Le geste s'appuie désormais sur des écouteurs de capture au niveau du document : permutation en direct pendant le glissement, ordre persisté au relâchement, et un dépose atterrissant sur un autre bouton de compétence ne peut plus ouvrir sa fenêtre par accident
- **Boutons de lancement personnalisés sur les cartes de bibliothèque de compétences** — Le menu de la carte gagne « Configurer les boutons de lancement… » : choisissez n'importe quel agent, un libellé, une icône, un modèle de prompt et une bascule d'envoi direct par compétence. Les boutons personnalisés s'affichent à côté des boutons sources automatiques — les compétences issues de dossiers personnalisés (qui ne lient aucun agent) disposent enfin d'un point d'entrée d'envoi, persisté avec la section
- **Mise en page de la fenêtre de configuration du pipeline** — Le sélecteur d'agent occupe un emplacement étroit fixe à côté du champ du nom de compétence (le texte long de l'option « bientôt disponible » ne fait plus exploser la ligne), et les modèles de prompt gagnent une fenêtre plein texte — lisez et modifiez l'intégralité dans une grande fenêtre, les modifications étant répercutées en direct
- **Dégagement du bas du tableau de bord** — Une fois défilé jusqu'en bas, la dernière section et le bouton d'ajout de section se dégagent désormais d'une fenêtre de chat IA ancrée en bas (60 → 200 px sur ordinateur) ; téléphones et mise en page immersive conservent leurs propres valeurs

### 3.8.7
- Paramètre régional en chinois traditionnel ; le thème Blossom reconstruit en Barbie ; correction du chevauchement des tuiles en mode immersif, rendu progressif des sections pipeline/PM et suppression du rail de sections sur mobile — voir les notes de version 3.8.7

### 3.7.1
- **Section RSS entièrement nouvelle** — Abonnez-vous à n'importe quel flux RSS 2.0 / Atom et toutes les sources convergent dans un unique flux anti-chronologique : points non-lus et filtre des non-lus, classement par groupe ou par flux (liste de groupes gérée, créable directement depuis une ligne de flux), et pagination avec taille de page configurable (10/20/50/100). Cliquez sur un article pour le lire dans une fenêtre de lecture thématisée — les flux limités au résumé voient leur page complète récupérée et leur contenu principal extrait automatiquement, avec repli sur le résumé et un bouton « ouvrir dans le navigateur ». Chaque article s'enregistre dans le coffre sous forme de note en un clic (le frontmatter reflète le modèle de boîte de réception 「01 收集」, alimentant le pipeline PARA), et les articles enregistrés renvoient directement à leur note. Import OPML inclus (les catégories deviennent des groupes, avec déduplication des URL) ainsi que l'export. Les flux sont mis en cache localement pendant 30 minutes (les sources en échec réessaient dans 5 minutes, concurrence polie de quatre requêtes), et les flux défaillants sont nommés ligne par ligne avec leur raison dans la fenêtre de configuration. La rétention des marqueurs de lecture est un réglage (30/90/180/365 jours ou pour toujours)
- **Corrections de lisibilité de la mise en page immersive** — le texte des champs invisible dans les sessions Obsidian claires (les règles de champ d'Obsidian prîmont le dessus sur celles du plugin) et les titres de colonnes kanban délavés en blanc (un `--db-bg` manquant dans le bloc de variables immersives) sont tous deux corrigés à la racine ; les petits boutons d'icône des sections et des fenêtres ne sont plus repeints ni écrasés par l'habillage natif des boutons d'Obsidian
- **Les catégories de dépenses prédéfinies sont modifiables** — les préréglages se comportent désormais exactement comme les personnalisés : suppression, réorganisation et mapping de groupe pour tous ; l'historique continue de s'afficher sous les libellés supprimés et les noms libérés peuvent être rajoutés ; chaque sens conserve au moins une catégorie
- **Menu contextuel immersif allégé** — l'entrée « ranger la mise en page », sous-performante, disparaît ; « supprimer la carte » reste

### 3.7.0
- **Mise en page immersive entièrement nouvelle** — chaque espace de travail peut basculer en mode immersif : un fond d'affiche plein cadre avec horloge et barre de capture centrée, et chaque widget, mémo et todo en carte de verre librement déplaçable — redimensionnement par les bords, alignement avec magnétisme intelligent. Créez-en un depuis le bouton + du sélecteur d'espaces de travail

### 3.6.6
- **Thèmes enregistrés du Studio d'apparence** — les looks personnalisés s'enregistrent comme thèmes avec bascule en un clic, plus une entrée en commande rapide
- **Boucliers anti-détournement de saisie** — les extraits de tiers ne peuvent plus détourner les champs de saisie du tableau de bord avec des styles globaux
- **Correction du saut silencieux de la musique** — les échecs de lecture NetEase occasionnels ne sautent plus silencieusement ; ils notifient d'abord selon la cause
- **Plafond de rendu relevé** — le rendu progressif par groupes plafonne désormais à 500 éléments, les très grandes sections montrent donc davantage d'elles-mêmes

### 3.6.5
- **Suppression des cartes sur place** — les cartes en grille, galerie et kanban des sections base de données/dossier affichent au survol un bouton corbeille dans un coin (toujours visible sur mobile) — fini de fouiller les menus
- **Nouvelle note à partir de plusieurs modèles** — le réglage « modèle de nouvelle note » accepte désormais plusieurs modèles ; choisissez-en un à chaque clic sur le « + » de la barre d'outils, et la note arrive préremplie avec les filtres de la section. Les réglages à modèle unique migrent automatiquement
- **Contrôle des colonnes de la vue tableau** — un bouton œil dans la barre d'outils liste chaque champ de propriété : masquez ce dont vous n'avez pas besoin et glissez pour réordonner, mémorisé par section ; les anciens réglages de colonnes migrent automatiquement
- **Protection de rendu pour les grands coffres** — les vues groupées et kanban rendent progressivement (50 par groupe/colonne avec une pastille « en voir plus ») et plafonnent à 2000 éléments avec un avertissement — les sections comptant des milliers de fichiers ne figent plus le tableau de bord
- **Anniversaires lunaires** — les dates d'anniversaire peuvent être lunaires (stockées sans perte comme dates solaires) ; les rappels correspondent aux anniversaires lunaires
- **Points focaux des couvertures et bannières** — les couvertures de projets et les fonds de bannière permettent de choisir le point focal par glissement, mémorisé par image en rotation
- **Horaires et destinations des tâches du calendrier** — les tâches prennent en charge les champs de date de début/d'échéance/planifiée avec horaires facultatifs sur plusieurs jours (`[start::]`/`[due::]`/`[scheduled::]`) ; un mode de destination « une note par tâche » crée/annexe automatiquement une note datée
- **Sections sans couverture fusionnées dans Notes** — le type « notes sans couverture » fusionne dans « Notes » avec une bascule « afficher les couvertures » par section ; les anciennes configurations migrent automatiquement
- **Filtres de propriétés pour les sections dossier** — les sections dossier gagnent le même éditeur de filtres de propriétés que les sections base de données (égal/contient/non-égal)

### 3.6.3
- **Regroupement pour les vues bibliothèque/dossier** — les vues grille, galerie, liste et tableau gagnent un bouton de barre d'outils « Grouper » : pas de regroupement, par dossier (dossiers de premier niveau sous les dossiers analysés) ou par n'importe quelle propriété de frontmatter ; le choix persiste par section dans le fichier du tableau ; la vue kanban conserve son regroupement par fenêtre de configuration existante
- **Déplier/replier tous les groupes** — regroupement actif, les sections bibliothèque/dossier gagnent un bouton de barre d'outils qui déplie ou replie tous les groupes en un clic ; l'icône et l'info-bulle suivent l'état courant
- **Zone de widgets redimensionnable** — mise en page latérale : tirez le bord de la barre latérale pour en redéfinir la largeur (180–420 px, mémorisé) ; mise en page empilée : tirez la bande de widgets pour en régler la hauteur (240–560 px) ; les paliers de hauteur des widgets habitudes et lecture (plein / deux tiers / moitié / un tiers) sont sélectionnables dans les réglages
- **Correction de lecture du widget musique** — les pannes intermittentes d'habilitation NetEase -110 font désormais l'objet de tentatives espacées avant abandon, les titres habilités ne sont plus sautés ; les titres réellement injouables s'identifient et donnent la raison (abonnement, achat ou droits régionaux) dans une notification avant de passer au suivant — fini les sauts silencieux
- **Archivage en un clic vers la note quotidienne du jour** — un nouveau réglage « Destination d'archivage » : le fichier fixe (comme avant) ou la note quotidienne du jour (créée automatiquement d'après le modèle du plugin Daily notes natif si absente) ; l'archivage s'interrompt avec une notification si la note quotidienne est introuvable
- **Modèle personnalisé pour l'enregistrement des mémos** — l'enregistrement d'une carte mémo/sticky en note prend désormais en charge un modèle personnalisé
- **Correction de performance d'actualisation** — les changements du coffre ne reconstruisent que les sections dont le périmètre d'analyse couvre le chemin modifié : éditer des notes ailleurs, les dépôts RSS et le chamboulement d'images ne font plus clignoter toutes les sections bibliothèque/dossier ; une section dont les résultats de requête sont inchangés saute complètement la reconstruction (éditions hors périmètre : 3 sections par passe → 0)
- **Position de défilement conservée partout** — les rendus complets photographient l'état de défilement de toute la page (défilement horizontal du carrousel de widgets empilés, zone de défilement, carrousels de cartes, listes de tâches, listes internes des widgets) et le rejouent exactement ensuite ; les clés fondées sur des ancres survivent aux réorganisations de sections/widgets — là où vous travailliez, vous restez, fini les sauts en haut de page

### 3.6.2
- **Jeux de couleurs et préréglages du Theme Studio** — chaque zone de couleur gagne un menu déroulant de jeu de couleurs (suivre le thème / clair / sombre / personnalisé, la recette de premier plan sur fond de widget) avec des préréglages par champ pour un choix rapide
- **Nouvelle note dans les sections Notes** — les sections notes avec et sans couverture gagnent un bouton « nouvelle note » par carte, plus des réglages de section pour le modèle de nouvelle note et le dossier d'enregistrement (racine du coffre si non défini)
- **Les cartes mémo rendent le markdown** — les cartes mémo et sticky rendent leur corps via le moteur de rendu d'Obsidian (adaptation préservant les lignes, les mémos existants gardent leur apparence)
- **Correction** — le modèle de nouvelle note de la section dossier était silencieusement perdu à l'enregistrement des réglages ; le frontmatter du modèle fusionne désormais sous les propriétés de filtre, lignes brutes préservées

### 3.6.1
- **Les barres d'outils de sections se replient en boutons déroulants** — le sélecteur de vue et les contrôles de taille de carte (S/M/L) des sections bibliothèque/dossier/images/vidéos se replient chacun en un unique bouton affichant le choix courant ; un clic ouvre le menu natif pour choisir — une barre d'outils bien plus discrète
- **Périmètre d'affichage des images/vidéos** — un nouveau réglage « Périmètre d'affichage » : multi-sélection de dossiers du coffre (avec sélecteur) ; une fois défini, seuls les fichiers sous ces dossiers s'affichent (les exclusions s'appliquent toujours à l'intérieur du périmètre) ; vide = tout le coffre
- **Modèle de nouvelle note par section** — les fenêtres de configuration dossier/bibliothèque gagnent un « Modèle de nouvelle note » : les notes créées depuis le « + » de la barre d'outils partent du corps du modèle ({{title}} et {{date:…}} substitués) avec les propriétés de filtre de la section toujours préremplies ; un modèle absent dégrade en note nue
- **Destination des tâches du calendrier** — les réglages du calendrier gagnent une « Destination des tâches » : conserver la chaîne par défaut (note quotidienne du jour → liste de todos du tableau), ou épingler un fichier précis (insertion en haut/en bas) ou un dossier (une note AAAA-MM-JJ par jour, créée automatiquement)
- **Boutons d'action rapide en verre dans tous les thèmes** — les remplissages et bordures des boutons Earth/Nordic/Island/Tundra/Matcha/Lilac/Vermilion/Aurora sont désormais en verre translucide teinté de l'accent, à l'instar des cinq thèmes qui l'avaient déjà — les douze se ressentent pareil
- **Alpha du Theme Studio et arrière-plan de page corrigés** — chaque ligne de couleur gagne un curseur d'opacité (0–100 %) ; l'arrière-plan de page personnalisé s'applique réellement (les dégradés des thèmes à nappes sont remplacés aussi) et un alpha 0 laisse apparaître l'arrière-plan d'Obsidian
- **Panneau intérieur givré sur les cartes à image d'arrière-plan** — avec une image d'arrière-plan définie, un panneau distinct en verre dépoli flotte au-dessus de la photo (flou réel + remplissage de carte du thème + bord supérieur éclairé) ; le widget pomodoro rejoint le club des images d'arrière-plan (engrenage dans son groupe de ligne supérieure)
- **Nombreux raffinements** — le marque-page de la bannière repliée se rétracte jusqu'au survol ; le bouton palette d'actions rapides est retiré (les images et couleurs de premier plan le remplacent) ; les boutons d'en-tête des habitudes toujours visibles ; la couleur de premier plan personnalisée retourne aussi le texte hérité (libellés des actions rapides corrigés) ; correction du widget lunaire perdant la réorganisation par glissement après actualisation asynchrone (délégation d'événements) ; correction du drag de paire à largeur variable cassé sur Windows (valeur de partenaire périmée en boucle + arrondi subpixel + événements avalés par la webview, les trois racines)

### 3.6.0
- **Mise en page empilée entièrement nouvelle** — Réglages → Général → Mise en page gagne une sélection illustrée : côte à côte (classique) ou empilée — les widgets s'arrangent en carrousel de cartes proportionnel à leur hauteur (plein / deux tiers / moitié / un tiers) sous la bannière, la barre de notes rapides reste épinglée, widgets et sections défilent comme une seule page, épinglage/repli inchangés ; téléphones non concernés
- **Fonds de widgets et jeux de couleurs de premier plan** — Anniversaires, compte à rebours, progression de l'année, musique, habitudes et actions rapides prennent en charge des arrière-plans personnalisés (le sélecteur d'images ne liste que des images, les URL d'images réseau bienvenues) avec curseurs d'opacité / assombrissement / flou et couleurs de premier plan clair / sombre / sélecteur personnalisé ; l'engrenage du coin de la carte les change sans quitter le tableau de bord
- **Nouveau widget Anniversaires** — Temps écoulé depuis une date historique (années-mois-jours / total de jours / précision jours+heures), rappel facultatif chaque année à la même date, sélecteur de date natif
- **Widget album multi-instances** — Ajoutez autant d'albums que voulu, chacun avec son propre dossier et sa taille de carte
- **Correction : drag de paire à largeur variable cassé sur Windows** — Les trois causes racines corrigées (valeur de partenaire périmée enroulant les lignes, arrondi subpixel, pages intégrées avalant les événements souris via une protection de capture de pointeur)

### 2.5.3
- **Réorganisation des catégories et groupes principaux** — La fenêtre « Gérer les catégories » trie désormais par glissement (préréglages inclus ; le menu déroulant d'entrée et les filtres du grand livre suivent ; les boutons haut/bas couvrent le tactile). Un nouveau niveau de groupes principaux : créez des groupes, attribuez des catégories, et le grand livre gagne une colonne « Groupe principal » plus un filtre par groupe (avec un compartiment « Non groupé ») ; l'anneau des statistiques et le classement basculent entre agrégation par catégorie et par groupe. Le regroupement est stocké séparément : regrouper à nouveau re-classe tout l'historique sans toucher au moindre enregistrement
- **Historique par semaine et par mois** — La plage « Historique » des statistiques gagne une sous-bascule semaine/mois/année avec pagination ‹ › : consultez n'importe quelle semaine passée (étiquetée avec sa plage de dates), son mois ou son année ; les deltas des KPI se comparent à la période similaire précédente, et les tendances se tracent au jour pour les semaines/mois et au mois pour les années ; la pagination s'arrête à la période courante et à la plus vieille année ayant des données
- **Correction : pastilles de delta KPI écrasant le nombre** — Les cartes de statistiques dépenses et pomodoro donnent désormais à la valeur sa propre ligne centrée, la pastille de comparaison à la période précédente étant repliée et centrée dessous — fini le tassement et le débordement de la carte

### 2.5.2
- **Autoguérison de la lecture musicale** — Un échec passager ne fait plus surgir « erreur de lecture, passage au titre suivant » et ne perd plus définitivement le morceau : il réessaie silencieusement le même titre une fois avec un lien signé neuf (les coupures en cours de flux reprennent à la même position, et les liens expirés pendant une longue pause sont remplacés par des neufs) ; ce n'est que si la nouvelle tentative échoue qu'il passe discrètement à la suite. Trois notifications actionnables subsistent : le clic sur un titre VIP, une connexion expirée et l'arrêt coupe-circuit après des échecs répétés
- **Menu déroulant de police de la citation de bannière** — Fini la saisie manuelle des noms de polices : choisissez dans un menu déroulant de huit visages chinois (KaiTi, Songti, Fangsong, Lishu, Xingkai, Yuanti, Heiti, LXGW WenKai) et huit occidentaux (Georgia, Times, Palatino, Baskerville, Garamond, Didot, Helvetica, Courier). Chaque entrée stocke une pile de polices multiplateforme : un seul réglage s'affiche pareillement sur macOS, Windows et iPad ; les noms saisis à la main auparavant restent sélectionnables dans le menu déroulant

### 2.5.1
- **Connexion au compte NetEase** — Sur ordinateur, ouvrez la page officielle NetEase depuis Réglages → Widgets → Musique (connexion par téléphone ou QR) et lisez avec les habilitations de votre compte — les titres d'abonnement et achetés se jouent en entier. Les identifiants vont directement à NetEase ; la session vit dans une partition Electron locale à l'appareil, jamais dans les données du plugin ni la synchronisation du coffre, et est effacée à la déconnexion. L'usage anonyme reste inchangé
- **Déplacement de cartes entre sections** — Faites glisser la barre de titre d'une carte pour la déplacer entre Todo, Mémo et Sticky ; les tâches et états de cochage survivent aux conversions Todo↔Mémo et les liens de notes voyagent avec ; les cartes de notes (avec ou sans couverture) peuvent entrer dans les trois sections également
- **Police de la citation de bannière** — À côté du sélecteur de couleur de citation, un nom de police personnalisé (ex. KaiTi, Georgia) met désormais en forme les lignes de citation et d'auteur ; la réinitialisation revient au défaut du thème
- **Sections bibliothèque/dossier plus hautes sur mobile** — Hauteur de ligne 50vh→60vh plus une barre d'outils allégée (compte/taille de page rangés) : la vue grille affiche 3-4 cartes sur les téléphones courants. Tablettes et ordinateur inchangés
- **Correction : cartes draguées disparaissant parfois** — Durcissement de la résolution des cibles de dépose et de l'ordre d'écriture ; les cartes ne disparaissent plus après un déplacement inter-section suivi d'un rechargement

### 2.5.0
- **Widget Album photo** — Pointez-le vers un dossier du coffre et il défile dans les images comme un cadre photo numérique : survol pour mettre en pause, précédent/suivant manuel (qui réarme le minuteur automatique pour ne jamais sauter deux fois), badge d'index, ratio de panneau 1:1 ou 3:4, quatre transitions (fondu / poussée gauche / poussée droite / zoom) pilotées par un ping-pong à deux couches, intervalle de 3 à 60 s, sous-dossiers inclus par défaut. La photo d'ouverture est semée par l'heure, la suivante préchargée, et les ajouts/suppressions/renommages dans le coffre actualisent la liste sur place — une photo courante survivante continue de défiler sans être dérangée
- **Widget Musique** — Recherchez et lisez des titres libres de NetEase Cloud Music dans la barre latérale : connexion facultative à un compte NetEase dans les réglages pour les titres membres autorisés par le compte, import de playlist par lien, contrôles de volume et de répétition, playlist persistante avec rechargement différé des pochettes, et une barre de mini-lecteur flottante facultative qui survit à la fermeture du tableau (bureau uniquement)
- **Correction : les contrôles à l'intérieur des widgets déclenchaient le drag de réorganisation** — Les widgets de la barre latérale étaient draguables en tant que tout : appuyer puis faire glisser un curseur de volume, un champ, un select ou un bouton était lu comme un geste de réorganisation (le plus visible sur le bouton de volume du panneau musique). Le glissement est désormais armé par geste : appuyer sur un contrôle de formulaire ou un bouton le laisse désactivé, appuyer sur la surface simple du widget l'active — cohérent dans tous les widgets
- **Fenêtre d'annonce** — Retitrée « 2 sections + 2 widgets » et présente désormais les widgets album et musique aux côtés des sections calendrier et web

### 2.4.1
- **Thème Vermilion (ex-Mono, renaît)** — Le duo funèbre noir/blou pur est soigné : un fond papier de riz chaud et une encre sumi aux reflets bleus remplacent les gris neutres, une dérive d'encre de 40 s (la plus lente de tous les thèmes) respire derrière les cartes, et un seul accent rouge sceau vermillon (liens, cases à cocher, focus, progression) se pose comme le tampon sur un rouleau — le duo noir/blanc demeure, l'ambiance passe de funérailles à bureau d'étude
- **Thème renommé** — Mono s'appelle désormais Vermilion ; les installations existantes gardent leur sélection intacte
- **Ordre des thèmes** — Blossom et Lilac déplacés après Pony, Vermilion après Matcha ; menu déroulant, commande de cycle et tableau du README sont synchronisés

### 2.4.0
- **Cinq thèmes renaissent** — Pony, Lilac, Earth, Nordic et Matcha gagnent tous des fonds à nappes dérivantes lentes (26–32 s, qui respirent plutôt que n'épater ; épinglés automatiquement sur mobile et sous reduced-motion) plus une assurance de fenêtres opaques (fini les dialogues blancs sur blanc sur bases Obsidian claires)
- **Pony (ex-Aurora)** — Arc-en-ciel MLP haut en saturation : six bandes d'aurore bonbon cyclant sur un ciel nocturne, et chaque section porte sa propre teinte poney sur le titre (mémo=rose Pinkie, todo=ambre Applejack, notes=beurre Fluttershy, projets=bleu Rainbow Dash, bibliothèque=violet Twilight…), avec lueurs de survol de cartes assorties et un dégradé de progression bonbon
- **Lilac** — Massif impressionniste : aquarelles glycine/rose/ivoire dérivant sur 28 s derrière des cartes ivoire translucides, avec un accent glycine qui se détache enfin du fond
- **Earth** — Soleil toscan : lumière miel/terracotta/olive rampant sur le parchemin pendant 32 s, sections en verre chaud sur cartes crème opaques, accent terracotta
- **Nordic** — Fjord polaire : aurore bleu givre/cyan glacé/indigo/menthe sur blanc froid, accent bleu glacier — fini les dalles d'ardoise plates
- **Matcha** — Esthétique du bol de thé : nappes de jardin de thé derrière des cartes en céramique crème translucides, accent matcha profond nettement séparé du fond sauge (ils étaient quasi identiques auparavant), notes dorées partout
- **Correction globale** — Quatre états actifs violets codés en dur (cartes d'ajout de section, options weread…) dérivent désormais de l'accent de chaque thème ; tous les thèmes en profitent

### 2.3.0
- **Section Calendrier** — La vue agrandie du calendrier de la barre latérale, intégrée directement au tableau : grille mensuelle complète (événements pluri-jours en barres continues) et grille horaire hebdomadaire, bascule mois/semaine, filtre de tâches et saut vers Aujourd'hui. Survolez une date pour apercevoir la liste complète des tâches du jour ; cliquez sur un numéro de date pour ajouter une tâche à ce jour (écrite dans la note quotidienne ou la liste de todos du tableau). Les tâches agrègent tout le coffre et la grille s'actualise sur place au gré des modifications de notes.
- **Section d'intégration Web** — Épinglez n'importe quelle page web au tableau : entrez une URL et elle s'intègre. Le mode Auto prévérifie la politique d'encapsulation du site — les sites autorisants se chargent en iframe, les réfractaires basculent vers une webview de bureau (connexion persistante ; parfait pour Google Keep ou TickTick web), et le mobile affiche une carte de secours avec bouton « ouvrir dans le navigateur ». Verrouillage manuel iframe/webview et zoom 0,5–2x pris en charge.
- **Correction : la fenêtre de confirmation de suppression assombrissait l'écran à chaque appui sur Entrée** — La fenêtre ne captait ni le focus ni les touches : chaque Entrée re-déclenchait le bouton de suppression encore focusé en dessous et empilait un voile mi-noir de plus. Elle focusse désormais le bouton sûr par défaut à l'ouverture avec une sémantique Entrée/Échap claire — fini l'empilement.

### 2.2.0
- **Vue galerie** — Les sections bibliothèque et dossier gagnent une vue galerie : les cartes rendent des images de couverture (depuis les champs `封面`/`cover` ou toute valeur ressemblant à une image) avec une bascule de taille S/M/L dans la barre d'outils, persistée par section ; le petit palier carre les couvertures 1:1, moyen/grand gardent du 16:10
- **Mémoire de taille des médias** — Les sections images/vidéos retiennent leur choix de taille de vignettes entre rechargements et redémarrages
- **Propriétés de cartes épinglées** — Choisissez exactement quels champs de frontmatter s'affichent sur les cartes (clés courantes épinglées d'abord, clés scannées du coffre, plus des ajouts personnalisés), en complément du repli au nombre maximal
- **Config dossier : recherche de tags** — Une boîte de recherche dans la section de filtre par tags pour se repérer vite quand le coffre compte beaucoup de tags
- **Corrections** — Bouton de fermeture dupliqué du popover de note sous Obsidian 1.13+ ; position d'insertion des tâches du calendrier, rendu des numéros de jour, sélecteur de chemins et durcissement du mapping des symboles météo

### 2.1.2
- **Island devient le thème par défaut** — Les nouvelles installations démarrent dans la palette pastel Animal Crossing ; deux nouvelles images de bannière par défaut
- **Heatmap du pomodoro remontée** — Dans la fenêtre de statistiques, la heatmap se situe désormais au-dessus de la frise du jour
- **Défilement préservé à l'édition** — Les actualisations sur place après édition de cartes ne remontent plus en haut de page

### 2.1.1
- **Rattrapage des habitudes** — Une icône d'horloge sur le widget habitudes ouvre une fenêtre de rattrapage pour les cochements de la veille (cochez individuellement ou sélectionnez tous les manqués)
- **Nouveaux todos en haut** — Les todo récemment ajoutés atterrissent en tête de liste
- **Espacement de la bannière** — Écart plus serré entre la bannière et le contenu

### 2.1.0
- **Multi-espaces de travail** — Plusieurs tableaux de bord dans un même coffre : chaque espace de travail a son propre fichier de tableau et sa configuration ; un sélecteur numérique en haut à gauche de la bannière permet d'y naviguer ; la page de réglages offre la réorganisation par glissement, le renommage et la redirection de chemin, sur mobile également

### 2.0.0
- **Vues groupées plus resserrées** — Gouttières plus denses dans les vues bibliothèque/dossier groupées pour afficher plus de cartes par écran
- **Groupe droit de la barre d'outils** — Les contrôles de compte et de pagination s'alignent uniformément sur le bord droit
- **Nouveau QR du groupe communautaire**

### 1.9.6
- **Grand livre des dépenses** — « Tout afficher » depuis la fenêtre de statistiques ouvre une table complète style Excel de chaque enregistrement : filtres type/catégorie/plage de dates/texte, tri par colonne, édition de ligne, suppression groupée confirmée, import CSV (les catégories inconnues s'enregistrent automatiquement) et export, pages de 50 lignes avec totaux filtrés
- **Catégories de dépenses personnalisées** — « + Nouvelle catégorie… » / « Gérer les catégories… » dans chaque menu déroulant de catégorie ; listes par sens avec compteurs d'usage, couleurs de graphiques déterministes, sûres pour la synchronisation
- **Les données de widgets se synchronisent entre appareils** — Les données d'habitudes, pomodoro, lecture et dépenses sont relues et fusionnées par union au focus de la fenêtre / au premier plan mobile ; chaque enregistrement fusionne d'abord les écritures étrangères, de sorte que les cochements faits sur un autre appareil survivent (les suppressions ne ressuscitent jamais)
- **Fenêtre de statistiques : mise en page deux colonnes alignée** — KPI + liste d'enregistrements à gauche, les quatre sections de graphiques empilées à droite ; repli par conteneur sur une colonne dans les panneaux étroits (corrige le chevauchement de zones) ; soulignement façon grand livre sous les champs de montants
- **Les couvertures de lecture acceptent les chemins d'images du coffre/locaux** — http(s), `data:`, chemins du coffre et chemins locaux de bureau ; les mini-panneaux flottants sont draguables et la pastille pomodoro peut être désactivée ; le calendrier plein écran retient son filtre de tâches

### 1.9.5
- **Widget de suivi des dépenses** — Saisie rapide de dépenses/revenus sur la barre latérale de bureau et la barre de widgets du téléphone, avec notes, saisies antidatées, totaux du jour et un volet de statistiques semaine/mois/année/depuis toujours
- **Widget calendrier du téléphone** — Grille mois/semaine, agendas de journée et vue mois plein écran sur la barre de widgets mobile ; les dates planifiées (`⏳`) et d'accomplissement (`✅`) ancrent les tâches à leurs jours, et les plages pluri-jours se tracent en barres continues

### 1.8.7
- **Section Notes repositionnables (便利贴)** — Mémos et todos côte à côte dans une même section : le bouton d'ajout ouvre un choix de type (icône + description) ; les cartes mémo gardent la palette de couleurs, l'enregistrement en note et l'édition en ligne, les cartes todo gardent la liste de tâches et la progression — plus un archivage en un clic des tâches terminées. Le style de la section suit la section todo
- **Taille de texte globale** — Petit / Moyen / Grand dans le Theme Studio met à l'échelle tout le tableau de bord proportionnellement
- **Filtre de date rapide de la bibliothèque** — Pastilles à fenêtre glissante « Dans les N jours » à côté de la plage de dates fixe
- **Dossiers exclus du calendrier via un sélecteur multi-sélection** — la sélection d'un parent couvre tous ses sous-dossiers
- **Dataview `WITHOUT ID` et « Vue libre »** — supprimez la colonne fichier dans `LIST`, et laissez chaque type de requête se rendre dans sa forme native
- **Les widgets de la barre latérale survivent aux éditions du tableau** — la bande de widgets est rattachee au lieu d'être reconstruite, le calendrier reste donc sur le mois ouvert et les comptes à rebours continuent de tourner

### 1.8.5
- **Commandes rapides dans la barre d'actions courantes** — Un quatrième type de pastille sur la barre supérieure épinglée : exécution en un clic de n'importe quelle commande Obsidian (native ou plugin). Ajoutez des commandes via une recherche à filtrage en direct sur l'intégralité du registre de commandes du coffre, puis renommez, changez l'icône et réorganisez par glissement chacune dans la fenêtre de configuration de la barre. Une commande obsolète (plugin désactivé ou supprimé) affiche une notification au lieu d'échouer en silence

### 1.8.4
- **Correction : mise en page de l'onglet de réglages cassée sur Obsidian 1.13+** — Le pont de réglages exposait chaque module comme une sous-page navigable : la nouvelle interface de réglages d'Obsidian les dispersait donc en pages séparées et comprimait les lignes de réglages sur le côté. L'onglet est désormais une page verticale unique, identique à la mise en page pré-1.13, et un bug de double rendu s'en va

### 1.8.2
- **Annonce Dataview + groupe communautaire** — Un popup unique à la mise à jour présente la nouvelle section Dataview et vous invite au groupe utilisateur WeChat (QR code inclus ; si l'invitation a expiré, ajoutez le contact WeChat `PandoraReads`)
- **Correction : wikilinks avec sous-chemins d'en-tête/bloc** — `[[note#heading]]` et `[[note#^block]]` dans les mémos et sections Dataview sautent désormais à l'ancre elle-même, et pas seulement en ouvrant la note : le chemin d'onglet se résout via le texte de lien natif, le popover de note défile avec `setEphemeralState` et les aperçus au survol montrent la position de l'ancre

### 1.8.0
- **Statistiques de concentration, redessinées en tableau de bord paysage** — Le popup de statistiques pomodoro est désormais une vue à trois colonnes : KPI (progression de l'objectif, concentration du jour, score d'efficacité, interruptions, respect des pauses, séries), anneau de répartition temporelle avec graphique de tendance adaptatif (heures/jours/mois selon la plage, base d'objectif quotidien en pointillés, barres de jours cliquables qui descendent dans les enregistrements de cette date), classement d'activités qui filtre la tendance, une heatmap à dégradé sur 12 semaines, et une frise du jour montrant le rythme travail→pause. Plages Jour/Semaine/Mois/Année/Tout sur périodes naturelles, colonne unique responsive sous 900 px
- **Objectif pomodoro quotidien** — Définissez un objectif (curseur dans les réglages, ou le crayon sur la carte vedette des statistiques) ; la progression s'affiche en `3/8` avec une jauge remplaçant l'anneau en cas d'activité unique
- **Gestion des tags pomodoro** — Renommez, supprimez, fusionnez et épinglez des tags d'activité depuis l'engrenage de l'en-tête des statistiques ; l'historique se réécrit sur place et les tags épinglés mènent la liste de sélection rapide du widget
- **Données pomodoro v2** — Le tag d'activité courant persiste entre redémarrages ; les enregistrements consignent les minutes réellement concentrées (pauses exclues), les comptes d'interruptions et l'issue des pauses (prise/sautée) ; le réglage de démarrage automatique de la pause est désormais honoré (les phases patientent en veille avec un bouton Commencer la pause / Reprendre la concentration)
- **Tags média pour les sections images & vidéos** — Taguez des images et vidéos individuelles et filtrez la section par tag ; les éditions depuis la grille, la table ou la lightbox sont antidébounce et ne re-rendent que cette section

### 1.7.0
- **Section Dataview (moteur DQL intégré)** — Un nouveau type de section qui exécute des requêtes à la Dataview sans plugin externe : `TABLE`, `LIST`, `TASK`, `CALENDAR` et `HEATMAP`, avec `FROM`/`WHERE`/`SORT`/`GROUP BY`/`FLATTEN`/`LIMIT`, environ 40 fonctions, champs `file.*`, frontmatter YAML et champs en ligne. Validation de syntaxe en direct dans la fenêtre de configuration, exemples en un clic et bouton d'actualisation manuelle. L'ancienne section Heatmap autonome est remplacée par les requêtes `HEATMAP` (les sections heatmap existantes replient en sécurité vers le style projet)
- **Bouton retour en haut** — Un bouton flottant en bas à droite fait remonter le tableau de bord en haut, avec insertion de safe-area sur mobile
- **Repli/dépli de sous-tâches plus rapide** — Toucher un chevron pour déplier/replier des sous-tâches (ou des documents imbriqués) pouvait prendre plusieurs secondes. Le repli est désormais une bascule DOM silencieuse sur place, sans re-rendu complet : c'est instantané
- **Correction : un parent replié ne pouvait se déplier après un changement chez un frère** — Cocher une tâche frère déclenchait un re-rendu laissant un parent replié sans DOM enfant, si bien que son chevron paraissait mort. Les enfants sont désormais toujours rendus (masqués via une classe), si bien que le dépli fonctionne à travers les re-rendus, repli imbriqué compris
- **Drag de carte mémo plus rapide (sans lag ni image fantôme)** — Déplacer une carte mémo reconstruisait tout le tableau et déchirait la carte draguée en double image en cours de transition. Les cartes se déplacent désormais en déplaçant physiquement leur nœud DOM — liens parsés et liaisons de survol restent intacts, la dépose est instantanée
- **Résolution des wikilinks plus rapide sur les grands coffres** — Les liens qui ne correspondaient pas par chemin exact scannaient tout le coffre, une fois par lien par rendu. Ils se résolvent désormais contre un index de noms de base mis en cache, synchronisé aux changements de fichiers — un scan complet du coffre devient une consultation de table de hachage

### 1.6.3
- **Correction du crash au tap sur iOS** — Sur iOS, toucher le tableau de bord juste après son chargement pouvait faire planter Obsidian (l'application redémarrait). Le mobile désactive désormais entièrement le flou d'arrière-plan — plusieurs couches de flou restaient actives et, combinées au comportement de tap d'iOS, dépassaient la limite de rendu de la WebView
- **Statistiques de bannière sur téléphones** — La bannière de statistiques n'affiche que la colonne centrale aux largeurs de téléphone ; les colonnes latérales étaient rognées auparavant

### 1.6.2
- **Vue Statistiques de la bannière** — Un nouveau mode de bannière (bascule en haut de la fenêtre baguette) affichant un tableau de bord à trois colonnes : **Échelle** (total des notes + bande de statistiques), **Activité** (série de jours + heatmap de contributions) et **Productivité** (achèvement des tâches / liens par note / connectivité avec barres de progression). Chaque métrique se calcule en direct depuis le coffre
- **Configurable** — Affichage/masquage par colonne et statistique vedette, métriques de progression de la colonne droite, curseurs de flou et d'assombrissement de l'arrière-plan, couleur d'accent, et un dossier de notes quotidiennes pour la série
- **Arrière-plan flouté** — L'image d'affiche reste visible derrière le panneau de statistiques via un flou réglable + un voile sombre
- **Correction de persistance** — La vue de bannière et sa configuration survivent désormais au rechargement / à la mise à jour du plugin (elles étaient réinitialisées en Affiche)
- **Correction de statistiques en direct** — Les statistiques s'actualisent désormais à mesure que vous éditez (l'actualisation était sautée sous la configuration par défaut)
- **La langue par défaut est désormais 中文**

### 1.6.1
- **Corrections de capture des Notes rapides & prise en charge des modèles** — La capture vers une note cible annexe désormais au fichier existant au lieu de créer un fichier sans extension parasite quand le chemin omet `.md` ; les nouvelles notes créées dans le dossier de capture peuvent être ensemencées depuis un modèle (nouveau réglage « Modèle pour les nouvelles notes »)
- **Horodatage de capture enrichi** — Les lignes capturées sont estampillées d'une date en wikilink + heure (`[[2026-08-09]] 14:30`) au lieu de la seule heure, si bien que vous pouvez filtrer dans tout le coffre et que la date renvoie à la note quotidienne
- **Section « Capture » renommée** — Désormais « Capture volatile » dans la configuration des Actions courantes
- **Actualisation météo plus rapide & flou mobile allégé** — L'actualisation météo met désormais à jour les cartes sur place au lieu de reconstruire le tableau de bord ; sur mobile, le flou d'arrière-plan des boutons/cartes est retiré et le flou des fenêtres plafonné à 6 px pour réduire la charge GPU

### 1.6.0
- **Guide de premier lancement pour la barre d'actions courantes** — Un popup de bienvenue centré au démarrage vous présente la nouvelle barre d'outils et peut l'activer en un clic. Affiché une fois par version
- **Glisser pour réordonner les boutons de Notes rapides** — Réarrangez les boutons de création/épinglés en glissant dans la fenêtre de configuration ; la mise en page de la barre d'outils est affinée (Aujourd'hui mène la bande, zone d'actions regroupée)
- **Correction du modèle de Daily Notes** — `{{date}}` et les autres variables de modèle sont désormais substituées quand le bouton Aujourd'hui crée une note, et la recherche des Daily Notes est plus résiliente entre versions d'Obsidian
- **Étagère Weread & validation de clé** — Pagination de l'étagère et rendu des barres de progression affinés ; la clé API est validée au préalable (doit commencer par `wrk-`)

### 1.5.0
- **Studio d'apparence** — Panneau dédié à la personnalisation en direct des couleurs, de l'image de fond, de l'opacité des surfaces, du flou de verre et du rayon des coins
- **Barre d'outils d'actions courantes** — Barre épinglée pour la création de notes en un clic, les notes épinglées et la capture en ligne
- **Sauvegarde et restauration du tableau de bord** — Instantanés périodiques du fichier du tableau avec restauration en un clic
- **Kanban à la Trello** — Vue kanban pour les sections projet, plus diverses corrections et finitions

### 1.4.4
- **Réglage de fuseau horaire TickTick** — Un nouveau fuseau horaire configurable (défaut `Asia/Shanghai`) corrige les todos du jour affichant une mauvaise heure/date quand le fuseau de votre système diffère de celui de votre compte TickTick. À configurer sous Réglages → TickTick → Fuseau horaire
- **Ouverture des notes directement dans un onglet** — Nouveau réglage (plus une bascule dans la palette de commandes) pour sauter le popover d'éditeur intégré : cliquer une carte de document ouvre la note dans un onglet immédiatement. Désactivé par défaut pour préserver le comportement popover existant

### 1.4.3
- **Conformité à la revue du Marketplace** — Corrections de sûreté de types et de qualité de code pour que le plugin passe la revue des plugins communautaires Obsidian : retrait des journaux de débogage `console`, remplacement des types `any` par des typages Electron corrects dans la connexion navigateur TickTick, ajout d'aides sûres de coercition de chaînes, et correction du rendu des sections pour construire des nœuds DOM détachés (une régression qui masquait toutes les sections de la barre latérale). Aucun changement de fonctionnalité visible par l'utilisateur.

### 1.4.2
- **Compétence Weread v1.0.4** — La compétence Weread embarquée mise à jour vers `skill_version` 1.0.4
- **Correction d'import des surlignages** — Importer les surlignages d'un livre dans une note fonctionne à nouveau
- **UI du bouton d'import** — Rafraîchi le bouton d'import dans la section Weread

### 1.4.1
- **Bascule de vue TickTick** — Commutateur de vue liste/kanban pour la section TickTick
- **Finitions de la heatmap** — Raffinements visuels de la section Heatmap
- **Corrections de performance** — Améliorations générales de rendu et de performance
- **Retrait d'Ember** — Suppression des reliquats d'UI « ember »

### 1.4.0
- **Nouvelles sections** — Types de sections Weread, TickTick et Heatmap
- **Réorganisation et redimensionnement des sections** — Réordonnez les sections et ajustez leurs hauteurs
- **Propriétés de cartes** — Taille, envergure de grille, couleur et image de couverture par carte

### 1.3.1
- **Prise en charge multi-dossiers** — Les sections médias, dossier et bibliothèque peuvent cibler plusieurs dossiers
- **Corrections d'UI** — Retrait des boutons de configuration dupliqués sur les sections dossier/bibliothèque ; restauration du bouton de suppression de la section bibliothèque

### 1.3.0
- **Corrections de revue de plugin** — Résolution des retours de la revue des plugins communautaires Obsidian : prise en charge des fenêtres popout via `activeDocument`, avertissements de prise en charge partielle CSS, globals ESLint et suivi de la config lint en CI

### 1.2.9
- **Vue semaine du calendrier** — Nouvelle bascule Mois | Semaine sur la section Calendrier. La vue semaine dans la colonne est une liste verticale compacte (triée par heure, avec libellés horaires) ; la vue semaine de la fenêtre plein écran est une grille horaire à la Google Agenda (axe des heures + 7 colonnes de jours, tâches positionnées/dimensionnées par heure, bande « toute la journée », ligne « maintenant »). Les heures proviennent des rappels `⏰` et de `[due::]`/`[start::]`/`[end::]` avec `HH:MM`
- **Ajout de tâches depuis le calendrier** — Cliquez un jour → son agenda permet d'ajouter une tâche (horaire facultatif) qui s'écrit dans la note quotidienne de ce jour (créée automatiquement d'après le modèle/chemin des Daily Notes) ; horodatée avec `⏰`, date seule avec `📅`
- **Retiré : section Toutes les tâches** — Elle scannait chaque fichier markdown du coffre à chaque rendu, ce qui faisait surchauffer les téléphones. La section Calendrier couvre toujours l'agrégation des tâches datées
- **Correction de performance et mobile** — Les vignettes vidéo ne fuient plus de décodeurs média (mémoire emballée + surchauffe/gel des téléphones corrigés) ; sur mobile elles rendent des espaces réservés statiques. Éditer une note n'actualise plus que la section concernée sur place au lieu de reconstruire tout le tableau (fini la « vidéothèque qui rafraîchit sans arrêt »)
- **Vidéo paresseuse (bureau) + scan plus rapide + GPU mobile** — Seules les tuiles à l'écran montent un vrai `<video>` (IntersectionObserver) ; le scan des tâches du coffre (Calendrier) saute les fichiers sans tâche et cède la main à l'UI ; le flou de verre par carte est désactivé sur mobile (≤640 px) pour réduire la charge GPU et la chaleur

### 1.2.8
- **Section Toutes les tâches** — Nouveau type de section qui agrège toutes les tâches à case à cocher du coffre (comme une requête `TASK` dataview) ; recherche, filtre de statut et tri
- **Regroupement + kanban** — Groupez les tâches par date (En retard/Aujourd'hui/Cette semaine/Plus tard/Sans échéance) ou par priorité ; vue liste avec groupes repliables, ou tableau kanban avec une colonne par groupe
- **Réécriture des tâches** — Cochez une tâche dans la vue Toutes les tâches ou Calendrier et la case à cocher de la note source se met à jour
- **Échéances & priorité** — Lit les échéances `⏰`, `[due::]`, `📅` et les priorités `[priority::]`
- **Section Calendrier** — Nouveau type de section : grille mensuelle native de toutes les tâches datées du coffre, avec une vue compacte dans la colonne et une fenêtre calendrier plein écran ; les événements pluri-jours (`[start::]`/`[end::]`) s'étendent sur plusieurs jours
- **Dossiers exclus** — Les sections Toutes les tâches et Calendrier peuvent exclure des dossiers du coffre (ex. Archive/Templates) de l'agrégation

### 1.2.7
- **Bascule de taille des vignettes** — La vue grille des images/vidéos a une bascule de taille S/M/L dans la barre d'outils (moyen = taille précédente)
- **Rétroliens** — Les vues liste et tableau des images/vidéos montrent quelles notes lient/intègrent chaque fichier ; cliquez une pastille pour ouvrir cette note dans le popover d'édition sur place
- **Sélecteur d'éléments par page** — Sections images/vidéos : choisissez 20 / 50 / 100 éléments par page
- **Popover de note sur mobile** — Sur mobile, cliquer des liens de documents et wikilinks ouvre désormais le popover d'éditeur de note sur place (comme sur bureau ; auparavant cela ouvrait un nouvel onglet)
- **Sections plus hautes + mise en page de la barre d'outils** — Les sections images/vidéos sont plus hautes par défaut ; le compte de fichiers et le sélecteur par page se placent à l'extrême droite de la barre d'outils
- **Chevauchement corrigé** — Les sections images/vidéos ne chevauchent plus le contenu en dessous après l'augmentation de hauteur

### 1.2.6
- **Pagination des médias** — La pagination des sections images/vidéos s'aligne désormais sur celle de la section base de données : centrée, avec plusieurs numéros de page (première/dernière + ellipses), au lieu d'un simple précédent/suivant
- **Sélecteur de dossier des médias** — Le champ dossier de l'entonnoir de filtre a désormais un bouton « Parcourir » qui ouvre une recherche floue de dossiers (comme la config de la section dossier), au lieu de saisir le chemin à la main

### 1.2.5
- **Filtre de tags retiré de l'entonnoir de la barre d'outils** — Le filtre (entonnoir) des sections base de données/dossier n'a plus de filtre de tags (redondant) ; il ne filtre que par date. Le filtre de tags de la section dossier dans sa fenêtre d'engrenage reste inchangé

### 1.2.4
- **Entonnoir de filtre des médias** — Les sections images/vidéos gagnent un entonnoir de filtre dans la barre d'outils : filtrage par plage de dates de création/modification et par chemin de dossier (sous-dossiers inclus) ; les filtres actifs s'affichent en pastilles amovibles
- **Colonne Nom à largeur fixe** — La colonne Nom de la vue tableau des images/vidéos est désormais à largeur fixe avec points de suspension, au lieu de croître avec les noms de fichiers longs

### 1.2.3
- **Vues liste et tableau des médias** — Les sections images/vidéos prennent désormais en charge les vues liste et tableau (en plus du mur de vignettes en grille) via une bascule dans la barre d'outils
- **Renommage des fichiers médias** — Double-cliquez le nom d'un fichier dans la vue tableau pour le renommer ; `![[embeds]]` et `[[links]]` se mettent à jour automatiquement
- **Suppression des fichiers médias** — Un bouton corbeille (avec confirmation) sur chaque élément média en grille/liste/tableau ; les fichiers supprimés vont à la corbeille d'Obsidian (récupérables)
- **Statistiques semaine/mois du pomodoro corrigées** — Semaine/mois utilisent désormais les bornes calendaires (lun→dim / 1er→fin) au lieu d'une fenêtre glissante de 7/30 jours
- **Lightbox des médias corrigée** — Les images/vidéos remplissent et centrent désormais correctement dans la fenêtre

### 1.2.2
- **Filtre de tags déplacé dans l'entonnoir de la barre d'outils** — Le filtre de tags de la section base de données déménage de la fenêtre de configuration vers le popup d'entonnoir (à côté du filtre de date)
- **Recherche de valeur repositionnée** — Config base de données : la boîte de recherche de valeur de propriété se place désormais à droite du menu déroulant de propriété (même ligne) au lieu de dessous
- **Limite de tags des cartes dossier** — Les cartes en grille de la section dossier affichent au plus 2 tags (badge +N) sur une seule ligne sans retour, si bien que les cartes ne grandissent plus avec beaucoup de tags

### 1.2.1
- **Section Images** — Un nouveau type de section qui scanne tout le coffre à la recherche d'images (png/jpg/jpeg/gif/svg/webp/bmp) et les affiche en mur de vignettes ; cliquez n'importe quelle vignette pour ouvrir une lightbox plein écran (←/→ pour naviguer, Échap pour fermer)
- **Section Vidéos** — Même idée pour les vidéos (mp4/mov/mkv/avi/webm/m4v) ; la grille montre la première image avec un badge de lecture, cliquez pour lire en ligne dans la lightbox
- Les deux sections prennent en charge recherche, tri et pagination

### 1.2.0
- **Édition des actions rapides** — Survolez une pastille de lien/commande rapide personnalisée pour révéler un bouton d'édition (en haut à gauche) ; cliquez pour la renommer et choisir une nouvelle icône. Bureau uniquement
- **Suppression de section** — Chaque en-tête de section a désormais un bouton corbeille qui retire toute la section après une fenêtre de confirmation
- **« Nouveau journal » corrigé** — L'action rapide passe désormais par le système de commandes d'Obsidian, si bien que la note quotidienne créée honore le dossier, le format de date et le modèle du plugin Daily notes natif

### 1.1.9
- **Les cartes dossier montrent les tags** — Les cartes en grille de la section dossier montrent désormais les tags du fichier (en pastilles) au lieu du chemin de dossier sur la ligne méta
- **Boîte de recherche de valeur** — Config base de données : chaque sélecteur de valeur de propriété a désormais une boîte de recherche pour filtrer la liste de pastilles
- **Kanban par défaut sur les tags** — Le « Grouper par » de la config base de données vaut désormais par défaut les tags (avec une aide)

### 1.1.8
- **Filtre de tags** — Les sections dossier et base de données gagnent une section dédiée de filtre Tags (pastilles activables ; un fichier s'affiche s'il porte au moins un tag sélectionné)

### 1.1.7
- **Section Dossier** — Un nouveau type de section qui liste chaque document sous un dossier du coffre choisi (sous-dossiers compris). Choisissez un dossier en saisissant le chemin ou en parcourant avec un sélecteur flou ; l'affichage réutilise les vues grille/liste/tableau/kanban de la section base de données avec tri, recherche et pagination

### 1.1.6
- **Enregistrer les todos dans la note quotidienne** — Un nouveau bouton d'enregistrement sur chaque carte todo écrit ses tâches (état d'accomplissement et imbrication préservés) en tête de la note quotidienne du jour (repérée via les réglages du plugin Daily notes natif)
- **Archivage des tâches terminées** — Un nouveau bouton d'archivage sur l'en-tête de la section todo déplace chaque tâche cochée vers un unique fichier d'archive cumulatif, en journal horodaté
- **Réglage du chemin d'archive des tâches** — Nouveau réglage pour le chemin du fichier d'archive (défaut `归档/已完成.md`)

### 1.1.5
- **Aperçu au survol des liens** — Maintenez Ctrl/Cmd et survolez n'importe quel lien de document ou `[[wikilink]]` pour voir un popover d'aperçu de page natif sans quitter le tableau de bord. Fonctionne dans les listes de documents des cartes projet/note, les wikilinks en ligne des mémos et todos, et la section base de données (bibliothèque)
- **Popover d'éditeur de note sur place** — Cliquez un lien pour ouvrir un popup centré qui intègre un éditeur Markdown Obsidian complet (Live Preview, plus une bascule lecture/source qui retient votre dernier choix). Lisez et éditez la note au sein même du tableau de bord au lieu d'ouvrir un nouvel onglet ; un bouton « Ouvrir dans un onglet » est disponible quand vous voulez l'éditeur complet
- **Prise en charge de la section base de données** — Les fichiers de la bibliothèque en vues grille, liste, tableau et kanban prennent désormais en charge l'aperçu au survol et le popover d'édition sur place, à l'égal de l'expérience de la section projet
- **Mobile inchangé** — Sur mobile, les liens gardent leur comportement d'ouverture en onglet d'origine

### 1.1.4
- **Sous-tâches repliables** — Les tâches avec sous-tâches peuvent désormais être repliées ; l'état replié persiste entre rechargements. Seuls les éléments ayant des enfants affichent une flèche de bascule, si bien que les feuilles ne portent aucun retrait gauche supplémentaire et les listes restent compactes
- **Liens de documents imbriqués (sous-documents) dans les cartes projet** — Les liens de documents des cartes projet prennent désormais en charge l'imbrication comme les sous-tâches : glissez-en un sur un autre pour l'imbriquer (zones de dépose avant / après / imbriquer), et repliez les sous-documents d'un parent. Enregistrés en listes imbriquées Markdown indentées, si bien que les liens restent valides dans toutes les vues Obsidian (pas de rupture de bloc de code due à l'indentation)
- **Tâches imbriquées (sous-tâches)** — Les tâches prennent désormais en charge l'imbrication multi-niveaux, persistée en Markdown indenté. Glissez une tâche sur une autre pour l'imbriquer (zones de dépose avant / après / imbriquer), réordonnez les tâches, ou déplacez-les entre cartes. Sur mobile, appui long pour glisser et balayage horizontal pour imbriquer/désimbriquer. Cocher une tâche parente coche tous ses enfants
- **Deux nouveaux thèmes : Mono & Onyx** — Ajout de Mono (minimal noir/blanc pur ; depuis renommé Vermilion — minimalisme à l'encre avec accent rouge sceau) et Onyx (noir pur avec accent citron, identique en clair et sombre). Retrait du thème Spring (Prism)
- **Enrichissements du widget heatmap** — La heatmap de la barre latérale peut désormais résoudre les fichiers de journal quotidiens depuis un dossier configurable, prend en charge un titre d'affichage personnalisé, et offre deux modes de plage : glissant (N derniers jours) ou période (mois / trimestre / année en cours)
- **Actualisation automatique du calendrier de la barre latérale** — Le calendrier hebdomadaire de la barre latérale met désormais à jour sa surbrillance « aujourd'hui » et ses dates automatiquement après minuit, même quand la vue du tableau de bord reste épinglée ouverte (auparavant il restait gelé au jour de sa première ouverture)
- **Nommage personnalisé des actions rapides** — En ajoutant une action rapide fichier ou commande, vous pouvez désormais définir un nom d'affichage personnalisé (et choisir une icône) à l'étape de confirmation, au lieu d'être cantonné au nom par défaut
- **Correction de l'image fantôme du drag sur mobile** — L'appui long sur une carte pour la glisser sur mobile ne laisse plus d'image fantôme de texte permanente à l'écran quand le toucher est interrompu par le système (gestes de bord, notifications, détournement de défilement). Un gestionnaire touchcancel nettoie désormais le fantôme de drag, les fantômes abandonnés sont balayés au re-rendu, et les transitions du clone fantôme et de la carte draguée sont désactivées pour supprimer les images fantômes traînantes
- **Enregistrer un mémo comme note** — Les cartes mémo peuvent être enregistrées comme notes autonomes dans votre coffre via un nouveau bouton « Enregistrer comme note », avec un dossier d'enregistrement configurable (réglage memoSavePath)

### 1.1.3
- **Refonte de la barre de widgets mobile** — Remplacement des boutons à onglets se chevauchant par une bande repliable sous la bannière. Touchez la bande pour révéler des onglets de marque-page plus larges (Pomodoro, Lecture, Lunaire), puis touchez un onglet pour déplier son panneau de widget
- **Couleurs d'onglets adaptées au thème** — Les icônes d'onglets passent désormais du gris (inactif) à la couleur de texte primaire du thème (actif), s'adaptant aux thèmes clairs comme sombres
- **Icônes de widgets mises à jour** — Pomodoro utilise une icône de sablier, Lunaire une icône de lune pour une identité visuelle plus claire
- **Dialogues personnalisés** — Remplacement des dialogues natifs du navigateur par des fenêtres personnalisées au style Obsidian
- **Renommage de classes** — Nettoyage des conventions de nommage de classes internes
- **Améliorations de style** — Diverses finitions visuelles et corrections de cohérence

### 1.1.2
- **Corrections de revue de plugin Obsidian** — Traitement des retours du processus officiel de revue des plugins Obsidian
- **Licence MIT** — Licence passée d'ISC à MIT

### v1.1.1
- **Persistance de la config bibliothèque** — Correction d'un bug critique où les configurations de la section bibliothèque (filtres, mode de vue, réglages de tri, taille de page) étaient perdues au redémarrage d'Obsidian. Le parseur YAML gère désormais correctement les objets imbriqués dans les définitions de colonnes
- **Persistance des positions de grille** — Correction des valeurs de position de grille (gcol/grow) jamais enregistrées dans le fichier du tableau, ce qui réinitialisait les positions des cartes au rechargement
- **Correction de condition de course à l'écriture** — Correction d'une condition de course où des mises à jour rapides pouvaient faire écraser par le surveillant de fichier des données plus récentes par un contenu plus ancien

### v1.1.0
- **Widget de suivi de lecture** — Gestion complète des sessions de lecture dans la barre latérale : ajout de livres via la recherche Douban ou une saisie manuelle, démarrage/pause/arrêt du minuteur de lecture, et enregistrement des sessions avec la progression en pages
- **Cartes livre** — Chaque livre actif affiche image de couverture, titre, auteur, barre de progression de lecture et temps de lecture du jour. Les images de couverture prennent en charge les URL web comme les chemins locaux du coffre
- **Édition des infos du livre** — Survolez une carte livre pour révéler les boutons d'édition (crayon) et de retrait (x). La fenêtre d'édition permet de changer titre, auteur, nombre total de pages et URL/chemin de la couverture
- **Statistiques de lecture** — Page de statistiques complète avec temps de lecture total, lecture du jour, nombre de livres, jours de série, liste de livres par plage de temps (semaine/mois/année) et enregistrements de sessions récents. Supprimez des enregistrements individuels ou des historiques de livres entiers
- **Sélecteur d'activité du pomodoro** — Le sélecteur d'activité déplacé à la position du titre du minuteur, avec un menu déroulant pour catégoriser les sessions de concentration
- **Graphique en anneau du pomodoro** — Répartition visuelle des sessions de concentration du jour par activité, affichée en anneau dans la vue statistiques

### v1.0.8
- **Widget météo de la barre latérale** — Météo en temps réel avec température actuelle, ressenti, humidité, vitesse du vent et prévisions sur 5 jours (icônes quotidiennes + max/min). Propulsée par Open-Meteo, aucune clé API requise
- **Widget heatmap de la barre latérale** — Heatmap de contributions à la GitHub pour suivre des données quotidiennes de frontmatter (humeur, sommeil, poids, etc.)
- **Résumé de la heatmap** — Statistiques configurables sous la heatmap : jours de série (⚡), taux d'accomplissement (✅), les deux, ou désactivé
- **Bande calendrier de la semaine** — Bande compacte de 7 jours dans la barre latérale, aujourd'hui en surbrillance
- **Recherche de ville** — Autocomplétion géocodée lors de la configuration de la ville météo dans les réglages
- **Cartes météo du tableau de bord** — Les widgets de carte météo du tableau principal montrent aussi le ressenti, l'humidité et le vent
- **i18n** — Tous les réglages des widgets de la barre latérale prennent désormais en charge l'anglais et le chinois
- **5 nouveaux thèmes** — Matcha (chaleur du thé vert), Lilac (violet doux), Sakura (rose fleur de cerisier), Eclipse (mode sombre), Moonlight (bleu argenté)

### v1.0.7
- **Rappels de tâches** — Définissez des rappels par tâche avec un popup calendrier. Cliquez l'icône de cloche sur n'importe quelle tâche pour choisir une date et une heure
- **Sélecteur de calendrier** — Calendrier mensuel visuel avec navigation, sélection de jour et menus déroulants heure/minute (plus de saisie de date à la main)
- **Indicateur de retard** — L'icône de cloche des tâches en retard passe au rouge avec une animation pulsée
- **Notifications Obsidian** — Un vérificateur périodique de 60 secondes déclenche une Notice Obsidian quand une tâche arrive à échéance
- **Stockage markdown en ligne** — Les rappels sont stockés sous la forme `⏰ YYYY-MM-DD HH:MM` dans le texte de la tâche, pleinement lisibles et modifiables dans le fichier markdown
- **Thème Island** — Nouveau thème pastel inspiré d'Animal Crossing avec sections vert forêt et accents bleu océan
- **i18n** — L'UI des rappels prend en charge l'anglais et le chinois
- **Cartes de section redimensionnables** — Glissez pour redimensionner n'importe quelle carte au sein d'une section, avec contraintes de largeur min/max et dimensionnement persistant
- **Barre latérale repliable** — La barre latérale gauche est désormais redimensionnable ; cliquez le bouton d'épingle pour la fixer en place
- **6 nouveaux thèmes** — Tundra (aurore vert sauge), Blossom (verre rosé, sections transparentes), Haze (brume bleue fumée, transparence de verre), Ember (fumée de feu de camp chaleureuse), Dusk (brume crépusculaire violette), Jade (brume de bambou verte)
- **Sections transparentes** — Tundra, Blossom, Haze, Ember, Dusk et Jade proposent des sections transparentes sans bordures avec cartes flottantes
- **Voile de bannière retiré** — Les images de bannière ne sont plus couvertes par un filtre d'obscurcissement sombre
- **Rotation de bannière plus rapide** — Les citations défilent chaque heure, les images chaque 30 minutes

### v1.0.6
- **Bannière multi-citations** — Stockez plusieurs citations dans la bannière, chacune avec son propre auteur. Ajoutez, modifiez et supprimez des citations dans la fenêtre d'édition
- **Rotation d'images de bannière** — Ajoutez plusieurs images d'arrière-plan qui défilent toutes les 2 heures avec une transition de fondu fluide
- **Rotation automatique des citations** — Les citations défilent toutes les 2 heures (décalées d'une heure par rapport à la rotation des images pour qu'elles ne basculent jamais en même temps)
- **Renommage des sections par double-clic** — Double-cliquez n'importe quel titre de section pour le renommer en ligne (Entrée pour valider, Échap pour annuler)
- **Sections repliables** — Cliquez l'indicateur triangulaire des en-têtes de section pour replier/déplier les sections. L'état de repli persiste d'une session à l'autre
- **Glisser-déposer entre cartes** — Faites glisser les liens de documents entre les cartes projet/note, et les tâches entre les cartes todo
- **Correction de réorganisation des cartes** — Correction du positionnement par glisser-déposer des cartes dans toutes les sections (Todo, Projets, Notes). Les cartes atterrissent désormais exactement où vous les déposez au lieu de toujours partir en première position
- **Interaction des cartes vides** — Les cartes vidées de tous leurs éléments peuvent désormais recevoir de nouveaux éléments par glisser-déposer ou via le champ d'ajout
- **Améliorations mobiles** — Bouton de sélection de couleur des mémos masqué sur mobile, tiroir mobile à fond uni pour tous les thèmes, liste d'actions rapides plus haute

### v1.0.5
- **Couleurs de bascule distinctes** — Chaque type de section (Mémo, Todo, Projets, Notes) a sa propre couleur d'indicateur triangulaire
- **Dimensionnement des boutons de la fenêtre de bannière** — Les boutons « Ajouter une citation » et « Ajouter une image » de la fenêtre d'édition de bannière utilisent désormais une largeur ajustée au contenu au lieu de s'étirer sur toute la largeur
- **Largeur par défaut des cartes projet** — Correction des nouvelles cartes projet s'étirant sur toute la section ; les cartes ont désormais une largeur par défaut correcte (280 px)
- **Robustesse des types de section** — Défense à trois niveaux pour la préservation des types de section : champ frontmatter `type:`, heuristiques par nom et analyse de la distribution des types de cartes. Les types de section survivent aux éditions manuelles du fichier, aux renommages d'en-têtes et aux échanges de positions
- **Persistance du type de carte projet** — `type: project` est désormais écrit dans le fichier et préservé d'un cycle enregistrement/rechargement à l'autre, empêchant les cartes de revenir au type générique
- **Correction du modèle par défaut** — Les sections Projets et Bibliothèque incluent désormais `sectionType` dans le modèle par défaut et les définitions de colonnes

### v1.0.4
- **Actions rapides** — Quick Links évolue en Quick Actions, prenant en charge les liens de fichiers et les raccourcis de commandes Obsidian
- **Fenêtre d'ajout d'action** — Deux onglets (Fichier / Commande) pour ajouter des actions personnalisées, avec préréglages intégrés pour Nouveau journal et Nouvelle note
- **4 types de sections** — Mémo, Todo, Projets et Notes, chacun avec sa propre mise en page et son propre comportement
- **Prise en charge de documents multi-formats** — Gérez Markdown, PDF, images (PNG, JPG, GIF, SVG, WebP), audio (MP3, M4A) et vidéo (MP4, MOV) dans les cartes projet
- **Liens bidirectionnels** — Les cartes Mémo et Todo rendent les `[[wikilinks]]` comme des liens cliquables avec repli sur le nom de base
- **Réglage du chemin du journal** — Configurez où sont enregistrées les nouvelles entrées de journal
- **Finitions d'UI** — Barres de défilement verticales masquées sur bureau, barre de défilement horizontale colorée par le thème, optimisation de la mise en page de la section notes
- **Corrections de bugs** — Correction des clics de wiki links dans les cartes mémo, de la condition de course au renommage des liens rapides, et du nettoyage des écouteurs de renommage au déchargement du plugin

### v1.0.3
- **Prise en charge des wikilinks** — Les cartes Mémo et Todo rendent désormais les `[[wikilinks]]` comme des liens cliquables
- **Sélecteur de type de section** — Choisissez le type de section lors de la création de nouvelles sections
- **Tiroir de barre latérale mobile** — Animation d'entrée en glissement pour la navigation mobile
- **UX de création de sections** — Bouton de confirmation pour la création de sections sur mobile, raccourci de commande « Ajouter une nouvelle section »
- **Corrections de bugs** — Drag de carte restreint à la zone d'en-tête/couverture, bouton d'édition de bannière mobile, alignement du tiroir

### v1.0.2
- **Gestion des sections** — Suppression manuelle de sections, sélecteur de type de section
- **Améliorations mobiles** — Meilleur défilement des cartes et mise en page mobile
- **Corrections de bugs** — Respect de l'ordre des sections du corps, prévention de la réinitialisation des formulaires

## Compatibilité

- Obsidian v0.15.0+
- Bureau et mobile
- Tous les thèmes fonctionnent dans les modes clair et sombre d'Obsidian

## Licence

0BSD

### Connexion au compte NetEase et confidentialité

Sur ordinateur, ouvrez Réglages → Apex Dashboard → Widgets → Musique et sélectionnez Téléphone / Connexion NetEase. Effectuez la connexion par téléphone sur le site officiel si proposée ; NetEase peut exiger une connexion par QR. Il n'existe pas de point de terminaison SMS distinct dans ce plugin. Les abonnements, achats et droits régionaux sont vérifiés par NetEase ; les extraits d'essai ne sont pas lus comme des titres complets.

Les identifiants sont soumis directement à NetEase. Le plugin utilise la session locale pour les requêtes de compte et d'URL de lecture. Les cookies restent dans une session Electron Obsidian locale isolée, en dehors de data.json et de la synchronisation du coffre. La déconnexion arrête la lecture et efface cette session locale. Reconnectez-vous si elle expire. Aucun proxy tiers n'est utilisé.

### Déplacer des cartes entre sections

Faites glisser l'en-tête d'une carte entre les sections Todo, Mémo et Sticky. Les notes, avec ou sans couverture, peuvent également entrer dans ces sections. Une destination Mémo affiche le texte original, les tâches et les liens sous forme de mémo. Une destination Todo conserve les tâches existantes et transforme les autres lignes de texte non vides et les liens de notes en éléments non cochés. Une destination Sticky préserve l'apparence originale de la carte, y compris le fait qu'une note ait une couverture. Les changements persistent entre rechargements. Déplacer une carte du tableau ne déplace ni ne supprime les fichiers du coffre qui y sont liés.
