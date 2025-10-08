# Hayden Park Portfolio

This is a personal website showcasing the biography, achievements, and creative works of Hayden Park. The website is built using TypeScript and includes various components to enhance user experience.

## Project Structure

- **src/**: Contains the source code for the application.
  - **index.ts**: Entry point of the application.
  - **components/**: Contains reusable components for the website.
    - **Header.ts**: Navigation bar and site title.
    - **Hero.ts**: Hero section with background image and introductory text.
    - **About.ts**: Biography, achievements, and interests of Hayden.
    - **Portfolio.ts**: Showcase of Hayden's work, including writing, music, and visual art.
    - **Contact.ts**: Contact form for visitors to reach out.
    - **Footer.ts**: Footer with social media links and copyright information.
  - **styles/**: Contains stylesheets for the website.
    - **main.css**: Main styles for layout and color schemes.
    - **typography.css**: Font styles and text alignment.
    - **animations.css**: CSS animations for a dynamic user experience.
  - **assets/**: Contains custom fonts used throughout the website.
  - **utils/**: Utility functions for common tasks.
    - **helpers.ts**: Functions for formatting dates and handling form submissions.
  - **types/**: Type definitions for the application.
    - **index.ts**: Interfaces for component props and data structures.

- **public/**: Contains public assets for the website.
  - **index.html**: Main HTML file serving as the template.
  - **favicon.ico**: Favicon for the website.

- **package.json**: Configuration file for npm, listing dependencies and scripts.

- **tsconfig.json**: TypeScript configuration file specifying compiler options.

- **.gitignore**: Specifies files and directories to be ignored by version control.

## Setup Instructions

1. Clone the repository:
   ```
   git clone <repository-url>
   ```

2. Navigate to the project directory:
   ```
   cd hayden-park-portfolio
   ```

3. Install dependencies:
   ```
   npm install
   ```

4. Start the development server:
   ```
   npm start
   ```

5. Open your browser and go to `http://localhost:3000` to view the website.

## Features

- A responsive design that adapts to various screen sizes.
- A hero section that introduces Hayden Park.
- Detailed biography and achievements in the About section.
- A portfolio showcasing creative works.
- A contact form for visitors to get in touch.
- Social media links in the footer.

## License

This project is licensed under the MIT License.